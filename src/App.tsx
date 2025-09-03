import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useApp, useStdout, useStdin } from 'ink';
import { ConversationList } from './components/ConversationList.js';
import { ConversationPreview } from './components/ConversationPreview.js';
import { ConversationPreviewFull } from './components/ConversationPreviewFull.js';
import { CommandEditor } from './components/CommandEditor.js';
import { getPaginatedConversations } from './utils/conversationReader.js';
import { spawn, spawnSync } from 'child_process';
import clipboardy from 'clipboardy';
import type { Conversation } from './types.js';
import { loadConfig } from './utils/configLoader.js';
import { matchesKeyBinding } from './utils/keyBindingHelper.js';
import type { Config } from './types/config.js';

interface AppProps {
  codexArgs?: string[];
  currentDirOnly?: boolean;
  hideOptions?: string[];
}

// Layout constants
const ITEMS_PER_PAGE = 30;
const HEADER_HEIGHT = 2; // Title + pagination info
const LIST_MAX_HEIGHT = 9; // Maximum height for conversation list
const LIST_BASE_HEIGHT = 3; // Borders (2) + title (1)
const MAX_VISIBLE_CONVERSATIONS = 4; // Maximum conversations shown per page
const BOTTOM_MARGIN = 1; // Bottom margin to absorb overflow
const SAFETY_MARGIN = 1; // Prevents Ink from clearing terminal when output approaches height limit
const MIN_PREVIEW_HEIGHT = 10; // Minimum height for conversation preview
const DEFAULT_TERMINAL_WIDTH = 80;
const DEFAULT_TERMINAL_HEIGHT = 24;
const EXECUTE_DELAY_MS = 500; // Delay before executing command to show status
const STATUS_MESSAGE_DURATION_MS = 2000; // Duration to show status messages

const App: React.FC<AppProps> = ({ codexArgs = [], currentDirOnly = false, hideOptions = [] }) => {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { setRawMode } = useStdin();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: DEFAULT_TERMINAL_WIDTH, height: DEFAULT_TERMINAL_HEIGHT });
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [showCommandEditor, setShowCommandEditor] = useState(false);
  const [editedArgs, setEditedArgs] = useState<string[]>(codexArgs);
  const [showFullView, setShowFullView] = useState(false);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [paginating, setPaginating] = useState(false);

  useEffect(() => {
    // Load config on mount
    const loadedConfig = loadConfig();
    setConfig(loadedConfig);
  }, []);

  useEffect(() => {
    loadConversations();
  }, [currentDirOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Update dimensions on terminal resize
    const updateDimensions = () => {
      setDimensions({
        width: stdout.columns || DEFAULT_TERMINAL_WIDTH,
        height: stdout.rows || DEFAULT_TERMINAL_HEIGHT
      });
    };
    
    updateDimensions();
    if (stdout) {
      stdout.on('resize', updateDimensions);
      return () => {
        stdout.off('resize', updateDimensions);
      };
    }
    return undefined;
  }, [stdout]);

  const executeCodexCommand = (
    conversation: Conversation,
    args: string[],
    statusMsg: string,
    actionType: 'resume' | 'start'
  ) => {
    const commandStr = `codex ${args.join(' ')}`;
    setStatusMessage(statusMsg);
    
    setTimeout(() => {
      exit();

      // Give Ink a moment to unmount and reset TTY before spawning Codex
      setTimeout(() => {
        // Ensure terminal is back to normal (raw mode off, cursor on, clear screen)
        try { setRawMode?.(false); } catch { void 0; }
        if (stdout && stdout.isTTY) {
          try {
            stdout.write('\u001b[0m');       // reset attributes
            stdout.write('\u001b[?25h');     // show cursor
            stdout.write('\u001b[?1049l');   // leave alt screen buffer (if enabled)
            stdout.write('\u001b[?2004l');   // disable bracketed paste mode
            stdout.write('\u001b[2J');       // clear screen
            stdout.write('\u001b[H');        // move cursor to home
            stdout.write('\u001bc');         // full terminal reset (ESC c)
          } catch { void 0; }
        }

        // On POSIX, ensure TTY is in a sane mode to avoid IME/input quirks
        if (process.platform !== 'win32') {
          try {
            spawnSync('stty', ['sane'], { stdio: 'ignore' });
          } catch { /* ignore */ }
        }

        // Output helpful information
        if (actionType === 'resume') {
          console.log(`\nResuming conversation: ${conversation.sessionId}`);
        } else {
          console.log(`\nStarting new session in: ${conversation.projectPath}`);
        }
        console.log(`Directory: ${conversation.projectPath}`);
        console.log(`Executing: ${commandStr}`);
        console.log('---');
      
      // Windows-specific reminder
      if (process.platform === 'win32') {
        console.log('💡 Reminder: If input doesn\'t work, press ENTER to activate.');
        console.log('');
      }
      
      // Spawn codex process
      const proc = spawn(commandStr, {
        stdio: 'inherit',
        cwd: conversation.projectPath || process.cwd(),
        shell: true
      });
      
      proc.on('error', (err) => {
        console.error(`\nFailed to ${actionType} ${actionType === 'resume' ? 'conversation' : 'new session'}:`, err.message);
        console.error('Make sure Codex CLI is installed and available in PATH');
        console.error(`Or the project directory might not exist: ${conversation.projectPath}`);
        
        // For resume action, provide clipboard fallback
        if (actionType === 'resume') {
          try {
            const resumeTarget = conversation.sourcePath || conversation.sessionId;
            clipboardy.writeSync(resumeTarget);
            console.log(`\nResume target copied to clipboard: ${resumeTarget}`);
            console.log(`Project directory: ${conversation.projectPath}`);
            console.log(`You can manually run:`);
            if (conversation.projectPath) console.log(`  cd "${conversation.projectPath}"`);
            const argsStr = editedArgs.length > 0 ? editedArgs.join(' ') + ' ' : '';
            console.log(`  codex ${argsStr}-c experimental_resume=${resumeTarget}`);
          } catch (clipErr) {
            console.error('Failed to copy to clipboard:', clipErr instanceof Error ? clipErr.message : String(clipErr));
          }
        }
        
        process.exit(1);
      });
      
      proc.on('close', (code) => {
        process.exit(code || 0);
      });
      }, 120);
    }, EXECUTE_DELAY_MS);
  };

  const loadConversations = async (isPaginating = false) => {
    try {
      if (isPaginating) {
        setPaginating(true);
        setConversations([]); // Clear current conversations
      } else {
        setLoading(true);
      }
      
      const currentDir = currentDirOnly ? process.cwd() : undefined;
      
      // Load paginated conversations
      const offset = currentPage * ITEMS_PER_PAGE;
      const { conversations: convs, total } = await getPaginatedConversations({
        limit: ITEMS_PER_PAGE,
        offset,
        currentDirFilter: currentDir
      });
      setConversations(convs);
      setTotalCount(total);
      
      setLoading(false);
      setPaginating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversations');
      setLoading(false);
      setPaginating(false);
    }
  };

  // Track previous page for detecting page changes
  const [prevPage, setPrevPage] = useState(0);
  
  // Reload conversations when page changes
  useEffect(() => {
    const isPaginating = currentPage !== prevPage;
    setPrevPage(currentPage);
    loadConversations(isPaginating);
  }, [currentPage, currentDirOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  useInput((input, key) => {
    // Don't process any input when command editor is shown
    if (showCommandEditor) return;
    
    if (!config) return;
    
    if (matchesKeyBinding(input, key, config.keybindings.quit)) {
      exit();
    }

    // Handle full view toggle first
    if (matchesKeyBinding(input, key, config.keybindings.toggleFullView)) {
      setShowFullView(prev => !prev);
      // Show temporary status message
      setStatusMessage(showFullView ? 'Switched to normal view' : 'Switched to full view');
      setTimeout(() => setStatusMessage(null), STATUS_MESSAGE_DURATION_MS);
      return;
    }

    // In full view, disable all navigation keys except quit and toggle
    if (showFullView) {
      return;
    }

    if (loading || conversations.length === 0) return;

    // Calculate pagination values
    const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);
    
    if (matchesKeyBinding(input, key, config.keybindings.selectPrevious)) {
      if (selectedIndex === 0 && currentPage > 0) {
        // Auto-navigate to previous page when at first item
        setCurrentPage(prev => prev - 1);
        setSelectedIndex(ITEMS_PER_PAGE - 1); // Select last item of previous page
      } else {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
      }
    }
    
    if (matchesKeyBinding(input, key, config.keybindings.selectNext)) {
      const maxIndex = conversations.length - 1;
      const canGoNext = totalCount === -1 ? conversations.length === ITEMS_PER_PAGE : currentPage < totalPages - 1;
      if (selectedIndex === maxIndex && canGoNext) {
        // Auto-navigate to next page when at last item
        setCurrentPage(prev => prev + 1);
        setSelectedIndex(0); // Select first item of next page
      } else {
        setSelectedIndex((prev) => Math.min(maxIndex, prev + 1));
      }
    }
    
    // Page navigation with arrow keys and n/p
    if (matchesKeyBinding(input, key, config.keybindings.pageNext)) {
      // For unknown total (-1), allow next if we got full page
      if (totalCount === -1 ? conversations.length === ITEMS_PER_PAGE : currentPage < totalPages - 1) {
        setCurrentPage(prev => prev + 1);
        setSelectedIndex(0); // Reset selection to first item of new page
      }
    }
    
    if (matchesKeyBinding(input, key, config.keybindings.pagePrevious) && currentPage > 0) {
      setCurrentPage(prev => prev - 1);
      setSelectedIndex(0); // Reset selection to first item of new page
    }
    

    if (matchesKeyBinding(input, key, config.keybindings.confirm)) {
      const selectedConv = conversations[selectedIndex];
      if (selectedConv) {
        // Experimental resume requires passing the JSONL file path via -c experimental_resume=
        const resumeTarget = selectedConv.sourcePath || selectedConv.sessionId;
        const commandArgs = [...editedArgs, `-c`, `experimental_resume=${resumeTarget}`];
        const commandStr = `codex ${commandArgs.join(' ')}`;
        executeCodexCommand(
          selectedConv, 
          commandArgs, 
          `Executing: ${commandStr}`,
          'resume'
        );
      }
    }

    if (matchesKeyBinding(input, key, config.keybindings.copySessionId)) {
      // Copy resume target (JSONL path) to clipboard
      const selectedConv = conversations[selectedIndex];
      if (selectedConv) {
        try {
          const resumeTarget = selectedConv.sourcePath || selectedConv.sessionId;
          clipboardy.writeSync(resumeTarget);
          // Show temporary status message
          setStatusMessage('✓ Resume target copied to clipboard!');
          setTimeout(() => setStatusMessage(null), STATUS_MESSAGE_DURATION_MS);
        } catch {
          setStatusMessage('✗ Failed to copy to clipboard');
          setTimeout(() => setStatusMessage(null), STATUS_MESSAGE_DURATION_MS);
        }
      }
    }

    if (matchesKeyBinding(input, key, config.keybindings.startNewSession)) {
      // Start new session without resuming
      const selectedConv = conversations[selectedIndex];
      if (selectedConv) {
        const commandArgs = [...editedArgs];
        executeCodexCommand(
          selectedConv,
          commandArgs,
          `Starting new session in: ${selectedConv.projectPath || process.cwd()}`,
          'start'
        );
      }
    }

    if (matchesKeyBinding(input, key, config.keybindings.openCommandEditor)) {
      setShowCommandEditor(true);
    }

  });

  if (loading) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color="cyan">Loading conversations...</Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color="red">Error: {error}</Text>
      </Box>
    );
  }

  // Get the selected conversation
  const selectedConversation = conversations[selectedIndex] || null;
  
  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);
  
  // Calculate heights for fixed layout
  const headerHeight = HEADER_HEIGHT;
  const listMaxHeight = LIST_MAX_HEIGHT;
  const visibleConversations = Math.min(MAX_VISIBLE_CONVERSATIONS, conversations.length);
  // List height calculation: 
  // LIST_BASE_HEIGHT includes borders (2) + title (1)
  const needsMoreIndicator = conversations.length > visibleConversations ? 1 : 0;
  const listHeight = Math.min(listMaxHeight, LIST_BASE_HEIGHT + visibleConversations + needsMoreIndicator);
  
  // Add safety margin to prevent exceeding terminal height
  const safetyMargin = SAFETY_MARGIN;
  const bottomMargin = BOTTOM_MARGIN;
  const totalUsedHeight = headerHeight + listHeight + bottomMargin + safetyMargin;
  const previewHeight = Math.max(MIN_PREVIEW_HEIGHT, dimensions.height - totalUsedHeight);
  
  if (showCommandEditor) {
    return (
      <CommandEditor
        initialArgs={editedArgs}
        onComplete={(args) => {
          setEditedArgs(args);
          setShowCommandEditor(false);
        }}
        onCancel={() => setShowCommandEditor(false)}
      />
    );
  }

  if (showFullView) {
    return <ConversationPreviewFull conversation={selectedConversation} statusMessage={statusMessage} hideOptions={hideOptions} />;
  }

  return (
    <Box flexDirection="column" width={dimensions.width} paddingX={1} paddingY={0}>
      <Box height={headerHeight} flexDirection="column">
        <Text bold color="cyan">cdxresume - Codex CLI Conversation Browser</Text>
        <Box>
          <Text dimColor>
            {(() => {
              const prevKeys = config?.keybindings.pagePrevious.map(k => k === 'left' ? '←' : k).join('/') || '←';
              const nextKeys = config?.keybindings.pageNext.map(k => k === 'right' ? '→' : k).join('/') || '→';
              const pageHelp = `Press ${prevKeys}/${nextKeys} for pages`;
              
              return totalCount === -1 ? (
                <>Page {currentPage + 1} | {pageHelp}</>
              ) : (
                <>{totalCount} total | Page {currentPage + 1}/{totalPages || 1} | {pageHelp}</>
              );
            })()}
          </Text>
          {editedArgs.length > 0 && (
            <Text color="yellow"> | Options: {editedArgs.join(' ')}</Text>
          )}
        </Box>
      </Box>
      
      <Box height={listHeight}>
        <ConversationList 
          conversations={conversations} 
          selectedIndex={selectedIndex}
          maxVisible={visibleConversations}
          isLoading={paginating}
        />
      </Box>
      
      <Box height={previewHeight}>
        <ConversationPreview conversation={selectedConversation} statusMessage={statusMessage} hideOptions={hideOptions} />
      </Box>
      
      {/* Bottom margin to absorb any overflow */}
      <Box height={bottomMargin} />
    </Box>
  );
};

export default App;
