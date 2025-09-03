import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { format } from 'date-fns';
import type { Conversation } from '../types.js';
import { extractMessageText } from '../utils/messageUtils.js';
import { strictTruncateByWidth } from '../utils/strictTruncate.js';
import { loadConfig } from '../utils/configLoader.js';
import { matchesKeyBinding } from '../utils/keyBindingHelper.js';
import { getShortcutText, hasKeyConflict } from '../utils/shortcutHelper.js';
import type { Config } from '../types/config.js';

interface ConversationPreviewProps {
  conversation: Conversation | null;
  statusMessage?: string | null;
  hideOptions?: string[];
}

export const ConversationPreview: React.FC<ConversationPreviewProps> = ({ conversation, statusMessage, hideOptions = [] }) => {
  const { stdout } = useStdout();
  const [scrollOffset, setScrollOffset] = useState(0);
  const terminalWidth = stdout?.columns || 80;
  const [config, setConfig] = useState<Config | null>(null);
  
  // Calculate available height for messages dynamically
  const [maxVisibleMessages, setMaxVisibleMessages] = useState(10);
  
  useEffect(() => {
    // Load config on mount
    const loadedConfig = loadConfig();
    setConfig(loadedConfig);
  }, []);

  useEffect(() => {
    // Adjust visible messages based on terminal height
    const terminalHeight = stdout?.rows || 24;
    // Reserve lines for fixed parts:
    // - Top window: 1 (title) + 8 (conversation list with borders)
    // - Bottom window fixed parts:
    //   - Border top: 1
    //   - Header: 1 (Conversation History)
    //   - Session info: 1
    //   - Project info: 1
    //   - Margin: 1
    //   - Inner border: 2
    //   - Scroll help: 1
    //   - Border bottom: 1
    //   - Margin: 1
    // Total fixed: 9 (top) + 10 (bottom fixed) = 19
    // Add extra buffer (2 lines) for multi-line text overflow
    const bottomMargin = 2;
    const calculatedHeight = terminalHeight - 19 - bottomMargin;
    // Minimum 5 lines, no maximum limit
    const availableHeight = Math.max(5, calculatedHeight);
    setMaxVisibleMessages(availableHeight);
  }, [stdout?.rows]);

  // Filter messages based on hideOptions
  const filteredMessages = conversation ? conversation.messages.filter(msg => {
    if (!msg || (!msg.message && !msg.toolUseResult)) {
      return false;
    }
    // Hide tool result-only messages entirely
    if (msg.toolUseResult) {
      return false;
    }
    if (msg.message && Array.isArray(msg.message.content)) {
      const hasToolResult = msg.message.content.some((it: any) => it && it.type === 'tool_result');
      if (hasToolResult) return false;
    }
    
    // Get content to check message type
    let content = '';
    if (msg.message && msg.message.content) {
      content = extractMessageText(msg.message.content);
    } else if (msg.toolUseResult) {
      // Tool result messages are considered tool messages
      return !hideOptions.includes('tool');
    }
    
    // Check if this is a tool message
    if (hideOptions.includes('tool') && content.startsWith('[Tool:')) {
      return false;
    }
    
    // Check if this is a thinking message
    if (hideOptions.includes('thinking') && content === '[Thinking...]') {
      return false;
    }
    
    // Check if we should hide user messages
    if (hideOptions.includes('user') && msg.type === 'user') {
      return false;
    }
    
    // Check if we should hide assistant messages
    if (hideOptions.includes('assistant') && msg.type === 'assistant') {
      return false;
    }
    
    return true;
  }) : [];

  useEffect(() => {
    // When conversation changes, scroll to the bottom (most recent messages)
    if (conversation) {
      const totalMessages = filteredMessages.length;
      const maxOffset = Math.max(0, totalMessages - maxVisibleMessages);
      setScrollOffset(maxOffset);
    } else {
      setScrollOffset(0);
    }
  }, [conversation?.sessionId, maxVisibleMessages, filteredMessages.length]); // eslint-disable-line react-hooks/exhaustive-deps


  useInput((input, key) => {
    if (!conversation || !config) return;
    
    const totalMessages = filteredMessages.length;
    const maxOffset = Math.max(0, totalMessages - maxVisibleMessages);
    
    // Top
    if (matchesKeyBinding(input, key, config.keybindings.scrollTop)) {
      setScrollOffset(0);
      return;
    }
    
    // Page scrolling
    if (matchesKeyBinding(input, key, config.keybindings.scrollPageDown)) {
      setScrollOffset(prev => Math.min(prev + Math.floor(maxVisibleMessages / 2), maxOffset));
    }
    if (matchesKeyBinding(input, key, config.keybindings.scrollPageUp)) {
      setScrollOffset(prev => Math.max(prev - Math.floor(maxVisibleMessages / 2), 0));
    }
    
    // Line scrolling
    if (matchesKeyBinding(input, key, config.keybindings.scrollDown)) {
      setScrollOffset(prev => Math.min(prev + 1, maxOffset));
    }
    if (matchesKeyBinding(input, key, config.keybindings.scrollUp)) {
      setScrollOffset(prev => Math.max(prev - 1, 0));
    }
    
    // Bottom
    if (matchesKeyBinding(input, key, config.keybindings.scrollBottom)) {
      setScrollOffset(maxOffset);
    }
    
  });

  if (!conversation) {
    return (
      <Box borderStyle="single" borderColor="gray" paddingX={1} flexGrow={1}>
      </Box>
    );
  }

  // Count valid messages (with proper structure or tool results)
  const messageCount = filteredMessages.length;
  const duration = conversation.endTime.getTime() - conversation.startTime.getTime();
  const durationMinutes = Math.round(duration / 1000 / 60);
  
  // Clamp scroll offset to ensure the last message is visible
  const totalMessages = filteredMessages.length;
  const maxOffset = Math.max(0, totalMessages - maxVisibleMessages);
  const startIndex = Math.min(scrollOffset, maxOffset);
  const visibleMessages = filteredMessages.slice(startIndex, startIndex + maxVisibleMessages);
  
  // Calculate safe width for text wrapping
  // Layout nesting adds horizontal chrome:
  // - App root paddingX: 2 (left+right)
  // - Outer preview box border: 2
  // - Inner messages box border: 2
  // - Inner messages box paddingX: 2
  // Total chrome = 8 columns
  const SAFE_CHROME_WIDTH = 8;
  const safeWidth = Math.max(40, terminalWidth - SAFE_CHROME_WIDTH);


  return (
    <Box flexDirection="column" borderStyle="single" borderColor="green" flexGrow={1}>
      {/* Fixed header section */}
      <Box flexDirection="column" paddingX={1}>
        <Box>
          <Text bold color="green">Conversation History</Text>
          <Text> ({messageCount} messages, {durationMinutes} min)</Text>
        </Box>
        
        <Box>
          <Text bold>Session: </Text>
          <Text color="yellow">{strictTruncateByWidth(conversation.sessionId, safeWidth - 10)}</Text>
        </Box>
        <Box>
          <Text bold>Directory: </Text>
          <Text>{strictTruncateByWidth(conversation.projectPath, safeWidth - 12)}</Text>
        </Box>
        <Box marginBottom={1}>
          <Text bold>Branch: </Text>
          <Text>{strictTruncateByWidth(conversation.gitBranch || '-', safeWidth - 9)}</Text>
        </Box>
      </Box>

      {/* Messages area with inner border */}
      <Box borderStyle="single" borderColor="gray" flexGrow={1} paddingX={1} overflow="hidden">
        <Box flexDirection="column" height={maxVisibleMessages}>
          {visibleMessages.map((msg, index) => {
              // Skip messages without proper structure
              if (!msg || (!msg.message && !msg.toolUseResult)) {
                return null;
              }
              
              const isUser = msg.type === 'user';
              let content = '';
              
              // Do not render Tool Output details in preview (keep compact)
              if (msg.message && msg.message.content) {
                // Fall back to content-based rendering
                content = extractMessageText(msg.message.content);
              }
              
              const timestamp = new Date(msg.timestamp);
              
              // Skip if timestamp is invalid
              if (isNaN(timestamp.getTime())) {
                return null;
              }
              
              const isToolMessage = content.startsWith('[Tool:') || 
                                  content.startsWith('[Tool Output]') || 
                                  content.startsWith('[Tool Error]') || 
                                  content.startsWith('[Files Found:');
              
              // Combine role and content on single line for compact display
              const roleText = isUser ? 'User' : 'Assistant';
              const timeText = format(timestamp, 'HH:mm:ss');
              const header = `[${roleText}] (${timeText})`;
              
              // Get first line of content and truncate
              const firstLine = content.split('\n')[0];
              // Compute printable width for header (ASCII only here)
              const headerLength = header.length + 1; // +1 for space between header and content
              const availableWidth = safeWidth - headerLength;
              const truncatedContent = strictTruncateByWidth(firstLine, availableWidth);
              
              // Use a combination of timestamp and index for unique key
              const uniqueKey = `${msg.timestamp}-${scrollOffset + index}`;
              
              return (
                <Box key={uniqueKey}>
                  <Text>
                    <Text color={isUser ? 'cyan' : 'green'} bold>{header}</Text>
                    {isToolMessage ? (
                      <Text color="yellow" dimColor> {truncatedContent}</Text>
                    ) : (
                      <Text> {truncatedContent}</Text>
                    )}
                  </Text>
                </Box>
              );
            }).filter(Boolean)}
        </Box>
      </Box>
      
      {/* Fixed footer */}
      <Box paddingX={1} marginTop={1}>
        {statusMessage ? (
          <Text color="green" bold>{statusMessage}</Text>
        ) : config ? (
          <Box>
            <Text color="magenta">
              {getShortcutText(config, terminalWidth)}
            </Text>
            {hasKeyConflict(config) && (
              <>
                <Text color="magenta"> • </Text>
                <Text color="yellow" bold>⚠️ Key conflict - see --help</Text>
              </>
            )}
          </Box>
        ) : (
          <Text color="magenta">Loading shortcuts...</Text>
        )}
      </Box>
    </Box>
  );
};
