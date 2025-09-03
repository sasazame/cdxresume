import React, { useState, useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { execFileSync } from 'child_process';

interface CommandEditorProps {
  initialArgs: string[];
  onComplete: (args: string[]) => void;
  onCancel: () => void;
}

interface ClaudeOption {
  flags: string[];
  description: string;
  hasValue: boolean;
  valueDescription?: string;
}

// Fallback list, used when `codex -h` parsing fails
const defaultOptions: ClaudeOption[] = [
  { flags: ['-h', '--help'], description: 'Display help for command', hasValue: false },
  { flags: ['-v', '--version'], description: 'Output the version number', hasValue: false },
  { flags: ['-d', '--debug'], description: 'Enable debug mode', hasValue: false },
  { flags: ['--verbose'], description: 'Override verbose mode setting from config', hasValue: false },
  { flags: ['-p', '--print'], description: 'Print response and exit (useful for pipes)', hasValue: false },
  { flags: ['--output-format'], description: 'Output format (only works with --print): "text" (default), "json" (single result), or "stream-json" (realtime streaming)', hasValue: true, valueDescription: '<format>' },
  { flags: ['--input-format'], description: 'Input format (only works with --print): "text" (default), or "stream-json" (realtime streaming input)', hasValue: true, valueDescription: '<format>' },
  { flags: ['--mcp-debug'], description: '[DEPRECATED. Use --debug instead] Enable MCP debug mode (shows MCP server errors)', hasValue: false },
  { flags: ['--dangerously-skip-permissions'], description: 'Bypass all permission checks. Recommended only for sandboxes with no internet access.', hasValue: false },
  { flags: ['--allowedTools'], description: 'Comma or space-separated list of tool names to allow (e.g. "Bash(git:*) Edit")', hasValue: true, valueDescription: '<tools...>' },
  { flags: ['--disallowedTools'], description: 'Comma or space-separated list of tool names to deny (e.g. "Bash(git:*) Edit")', hasValue: true, valueDescription: '<tools...>' },
  { flags: ['--mcp-config'], description: 'Load MCP servers from a JSON file or string', hasValue: true, valueDescription: '<file or string>' },
  { flags: ['--append-system-prompt'], description: 'Append a system prompt to the default system prompt', hasValue: true, valueDescription: '<prompt>' },
  { flags: ['--permission-mode'], description: 'Permission mode to use for the session (choices: "acceptEdits", "bypassPermissions", "default", "plan")', hasValue: true, valueDescription: '<mode>' },
  { flags: ['-c', '--continue'], description: 'Continue the most recent conversation', hasValue: false },
  { flags: ['-r', '--resume'], description: 'Resume a conversation - provide a session ID or interactively select a conversation to resume', hasValue: true, valueDescription: '[sessionId]' },
  { flags: ['--model'], description: 'Model for the current session. Provide an alias for the latest model (e.g. \'sonnet\' or \'opus\') or a model\'s full name (e.g. \'claude-sonnet-4-20250514\').', hasValue: true, valueDescription: '<model>' },
  { flags: ['--fallback-model'], description: 'Enable automatic fallback to specified model when default model is overloaded (only works with --print)', hasValue: true, valueDescription: '<model>' },
  { flags: ['--settings'], description: 'Path to a settings JSON file to load additional settings from', hasValue: true, valueDescription: '<file>' },
  { flags: ['--add-dir'], description: 'Additional directories to allow tool access to', hasValue: true, valueDescription: '<directories...>' },
  { flags: ['--ide'], description: 'Automatically connect to IDE on startup if exactly one valid IDE is available', hasValue: false },
  { flags: ['--strict-mcp-config'], description: 'Only use MCP servers from --mcp-config, ignoring all other MCP configurations', hasValue: false },
  { flags: ['--session-id'], description: 'Use a specific session ID for the conversation (must be a valid UUID)', hasValue: true, valueDescription: '<uuid>' },
];

const SAFETY_MARGIN = 1;

// Layout constants
const LAYOUT_CONSTANTS = {
  FIXED_ELEMENT_HEIGHT: 15,
  SUGGESTIONS_BASE_HEIGHT: 5,
  MAX_SUGGESTIONS_SHOWN: 5,
  MIN_OPTIONS_LIST_HEIGHT: 10,
  OPTIONS_LIST_MARGIN: 4,
  DEFAULT_TERMINAL_HEIGHT: 24
} as const;

export const CommandEditor: React.FC<CommandEditorProps> = ({ initialArgs, onComplete, onCancel }) => {
  const { stdout } = useStdout();
  const [commandLine, setCommandLine] = useState(initialArgs.join(' '));
  const [cursorPosition, setCursorPosition] = useState(commandLine.length);
  const [options, setOptions] = useState<ClaudeOption[]>(defaultOptions);
  const [helpLines, setHelpLines] = useState<string[]>(getSnapshotHelpLines());
  const [descMap, setDescMap] = useState<Record<string, string>>({});
  const [suggestions, setSuggestions] = useState<ClaudeOption[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  
  const terminalHeight = stdout?.rows || LAYOUT_CONSTANTS.DEFAULT_TERMINAL_HEIGHT;
  const totalHeight = terminalHeight - SAFETY_MARGIN;

  // Load Codex CLI options dynamically from `codex -h` (fallback to defaultOptions)
  useEffect(() => {
    try {
      const out = execFileSync('codex', ['-h'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      const parsed = parseCodexHelp(out);
      if (parsed.length > 0) {
        setOptions(parsed);
      }
      const extracted = extractOptionsBlock(out);
      if (extracted.length > 0) setHelpLines(extracted);
      if (extracted.length > 0) setDescMap(buildDescriptionMap(extracted));
    } catch {
      // keep fallback options
    }
  }, []);

  function parseCodexHelp(helpText: string): ClaudeOption[] {
    const lines = helpText.split('\n');
    const parsed: ClaudeOption[] = [];
    for (const raw of lines) {
      const line = raw.replace(/\r/g, '');
      // match lines starting with short/long flags then description
      if (!/^\s*-{1,2}[A-Za-z0-9]/.test(line)) continue;
      const parts = line.trim().split(/\s{2,}/);
      const flagsPart = parts[0] || '';
      const descPart = parts.slice(1).join('  ');
      const flagTokens = flagsPart.split(/,\s*/);
      const flags: string[] = [];
      let valueDescription: string | undefined;
      for (let token of flagTokens) {
        const valMatch = token.match(/<([^>]+)>/);
        if (valMatch) valueDescription = `<${valMatch[1]}>`;
        token = token.replace(/<[^>]+>/g, '').trim();
        if (!token) continue;
        // ignore lone dashes that might be artifacts
        if (token === '-' || token === '--') continue;
        flags.push(token);
      }
      if (flags.length === 0) continue;
      const hasValue = Boolean(valueDescription) || /=/.test(flagsPart);
      parsed.push({ flags, description: descPart || '', hasValue, valueDescription });
    }
    return parsed;
  }

  // Intentionally preserve the order from `codex -h`; do not reorder entries.

  function extractOptionsBlock(helpText: string): string[] {
    const lines = helpText.replace(/\r/g, '').split('\n');
    const start = lines.findIndex(l => l.trim() === 'Options:' || l.startsWith('Options:'));
    if (start === -1) return [];
    // Take everything after the Options: header
    const block = lines.slice(start + 1);
    // Stop if we hit an empty line followed by another section header (heuristic)
    const stopIdx = block.findIndex((l, i) => l.trim() === '' && i > 0);
    const taken = stopIdx > 0 ? block.slice(0, stopIdx) : block;
    return taken;
  }

  // Build a map from long flag (e.g., --model) to combined description lines
  function buildDescriptionMap(lines: string[]): Record<string, string> {
    const map: Record<string, string> = {};
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!/^\s*-{1,2}[A-Za-z0-9]/.test(line)) continue;
      const parts = line.trim().split(/\s{2,}/);
      const flagsPart = parts[0] || '';
      let desc = parts.slice(1).join('  ');
      // append continuation lines (indented and not starting a new flag)
      let j = i + 1;
      while (j < lines.length && /^\s{2,}/.test(lines[j]) && !/^\s*-{1,2}[A-Za-z0-9]/.test(lines[j].trim())) {
        desc += (desc ? ' ' : '') + lines[j].trim();
        j++;
      }
      // pick a long flag if present
      const tokens = flagsPart.split(/,\s*/);
      const long = tokens.find(t => t.trim().startsWith('--')) || tokens[0];
      const key = (long || '').replace(/<[^>]+>/g, '').trim();
      if (key) map[key] = desc;
    }
    return map;
  }

  function getSnapshotHelpLines(): string[] {
    return [
      '  -c, --config <key=value>                        Override a configuration value that would otherwise be loaded from `~/.codex/config.toml`. Use a dotted path (`foo.bar.baz`) to override',
      '                                                  nested values. The `value` portion is parsed as JSON. If it fails to parse as JSON, the raw string is used as a literal',
      '  -i, --image <FILE>...                           Optional image(s) to attach to the initial prompt',
      '  -m, --model <MODEL>                             Model the agent should use',
      '      --oss                                       Convenience flag to select the local open source model provider. Equivalent to -c model_provider=oss; verifies a local Ollama server is',
      '                                                  running',
      '  -p, --profile <CONFIG_PROFILE>                  Configuration profile from config.toml to specify default options',
      '  -s, --sandbox <SANDBOX_MODE>                    Select the sandbox policy to use when executing model-generated shell commands [possible values: read-only, workspace-write,',
      '                                                  danger-full-access]',
      '  -a, --ask-for-approval <APPROVAL_POLICY>        Configure when the model requires human approval before executing a command [possible values: untrusted, on-failure, on-request, never]',
      '      --full-auto                                 Convenience alias for low-friction sandboxed automatic execution (-a on-failure, --sandbox workspace-write)',
      '      --dangerously-bypass-approvals-and-sandbox  Skip all confirmation prompts and execute commands without sandboxing. EXTREMELY DANGEROUS. Intended solely for running in environments',
      '                                                  that are externally sandboxed',
      '  -C, --cd <DIR>                                  Tell the agent to use the specified directory as its working root',
      '      --search                                    Enable web search (off by default). When enabled, the native Responses `web_search` tool is available to the model (no per‑call approval)',
      '  -h, --help                                      Print help (see more with "--help")',
      '  -V, --version                                   Print version'
    ];
  }

  useEffect(() => {
    // Update suggestions based on current input
    const currentWord = getCurrentWord();
    if (currentWord.startsWith('-')) {
      const matching = options.filter(opt => 
        opt.flags.some(flag => flag.toLowerCase().startsWith(currentWord.toLowerCase()))
      );
      setSuggestions(matching);
      setSelectedSuggestion(0);
    } else {
      setSuggestions([]);
    }
  }, [commandLine, cursorPosition]); // eslint-disable-line react-hooks/exhaustive-deps

  const getCurrentWord = () => {
    const beforeCursor = commandLine.substring(0, cursorPosition);
    const words = beforeCursor.split(' ');
    return words[words.length - 1] || '';
  };

  const insertSuggestion = (suggestion: ClaudeOption) => {
    // Guard against invalid suggestions
    if (!suggestion || !suggestion.flags || suggestion.flags.length === 0) {
      return;
    }
    
    // Validate cursor position
    if (cursorPosition < 0 || cursorPosition > commandLine.length) {
      return;
    }
    
    const beforeCursor = commandLine.substring(0, cursorPosition);
    const afterCursor = commandLine.substring(cursorPosition);
    const words = beforeCursor.split(' ');
    const currentWord = words[words.length - 1] || '';
    
    // Replace the current word with the suggestion
    const beforeWord = beforeCursor.substring(0, beforeCursor.length - currentWord.length);
    // Use the flag that matches the current input, or the last (long form) flag
    const matchingFlag = suggestion.flags.find(flag => flag.toLowerCase().startsWith(currentWord.toLowerCase())) || suggestion.flags[suggestion.flags.length - 1];
    // Always add a space after the flag to prevent re-matching
    const newCommand = beforeWord + matchingFlag + ' ' + afterCursor;
    setCommandLine(newCommand);
    setCursorPosition(beforeWord.length + matchingFlag.length + 1);
  };

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    
    if (key.ctrl && input === 'c') {
      onCancel();
      return;
    }

    if (key.return) {
      if (suggestions.length > 0) {
        // If suggestions are shown, insert the selected one
        insertSuggestion(suggestions[selectedSuggestion]);
      } else {
        // Otherwise, complete the editing
        const args = commandLine.trim().split(/\s+/).filter(arg => arg.length > 0);
        onComplete(args);
      }
      return;
    }

    // Navigation in suggestions
    if (suggestions.length > 0) {
      if (key.upArrow) {
        setSelectedSuggestion(prev => Math.max(0, prev - 1));
        return;
      }
      if (key.downArrow) {
        setSelectedSuggestion(prev => Math.min(suggestions.length - 1, prev + 1));
        return;
      }
      if (key.tab) {
        insertSuggestion(suggestions[selectedSuggestion]);
        return;
      }
    }

    // Text editing
    if (key.leftArrow) {
      setCursorPosition(prev => Math.max(0, prev - 1));
    } else if (key.rightArrow) {
      setCursorPosition(prev => Math.min(commandLine.length, prev + 1));
    } else if (key.backspace || key.delete) {
      if (cursorPosition > 0) {
        setCommandLine(prev => 
          prev.substring(0, cursorPosition - 1) + prev.substring(cursorPosition)
        );
        setCursorPosition(prev => prev - 1);
      }
    } else if (input && !key.ctrl && !key.meta) {
      setCommandLine(prev => 
        prev.substring(0, cursorPosition) + input + prev.substring(cursorPosition)
      );
      setCursorPosition(prev => prev + input.length);
    }
  });

  // Calculate display with cursor
  const displayCommand = () => {
    const before = commandLine.substring(0, cursorPosition);
    const at = commandLine[cursorPosition] || ' ';
    const after = commandLine.substring(cursorPosition + 1);
    
    return (
      <>
        <Text>{before}</Text>
        <Text inverse>{at}</Text>
        <Text>{after}</Text>
      </>
    );
  };

  // Calculate dynamic heights
  // Fixed elements: title (1) + help text (1) + command box (2) + disclaimer (4) + shortcuts (1) + borders (2) + padding (2) + margins (2) = 15
  const fixedHeight = LAYOUT_CONSTANTS.FIXED_ELEMENT_HEIGHT;
  
  // Height for suggestions if shown: title (1) + items + help (1) + borders (2) + margin (1) = 5 + items
  const suggestedCount = Math.min(suggestions.length, LAYOUT_CONSTANTS.MAX_SUGGESTIONS_SHOWN);
  const rawSuggestionsHeight = suggestions.length > 0 
    ? LAYOUT_CONSTANTS.SUGGESTIONS_BASE_HEIGHT + suggestedCount
    : 0;
  // Clamp suggestions height so that options list keeps at least MIN height
  const maxSuggestionsHeight = Math.max(
    0,
    (stdout?.rows || LAYOUT_CONSTANTS.DEFAULT_TERMINAL_HEIGHT) - SAFETY_MARGIN - LAYOUT_CONSTANTS.FIXED_ELEMENT_HEIGHT - LAYOUT_CONSTANTS.OPTIONS_LIST_MARGIN - LAYOUT_CONSTANTS.MIN_OPTIONS_LIST_HEIGHT
  );
  const suggestionsHeight = Math.min(rawSuggestionsHeight, maxSuggestionsHeight);
  
  // Calculate remaining height for options list
  const remainingHeight = totalHeight - fixedHeight - suggestionsHeight;
  const optionsListHeight = Math.max(
    LAYOUT_CONSTANTS.MIN_OPTIONS_LIST_HEIGHT, 
    remainingHeight - LAYOUT_CONSTANTS.OPTIONS_LIST_MARGIN
  );

  return (
    <Box height={totalHeight} flexDirection="column">
      <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1} paddingY={1}>
        <Text bold color="cyan">Codex Command Editor</Text>
        <Text dimColor>Edit command options for Codex. Press Enter to confirm, Esc to cancel.</Text>
        
        <Box marginTop={1}>
          <Text bold>Command: </Text>
          <Text>codex </Text>
          {displayCommand()}
        </Box>

        {suggestions.length > 0 && (
          <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
            <Text bold>Suggestions:</Text>
            {suggestions.slice(0, LAYOUT_CONSTANTS.MAX_SUGGESTIONS_SHOWN).map((suggestion, index) => {
              const flagText = suggestion.flags.join(', ');
              const isSelected = index === selectedSuggestion;
              // Prefer map description (handles multi-line wrapped help)
              const longFlag = suggestion.flags.find(f => f.startsWith('--')) || suggestion.flags[0];
              const mappedDesc = longFlag ? descMap[longFlag] : undefined;
              const descToShow = (mappedDesc || suggestion.description || '').trim();
              const hasDesc = descToShow.length > 0;
              return (
                <Box key={flagText}>
                  <Text color={isSelected ? 'green' : 'white'}>
                    {isSelected ? '▶ ' : '  '}
                    <Text bold>{flagText}</Text>
                    {hasDesc ? ' - ' : ''}
                    {hasDesc ? <Text dimColor>{descToShow}</Text> : null}
                  </Text>
                </Box>
              );
            })}
            <Box marginTop={1}>
              <Text dimColor>↑↓ to navigate, Tab/Enter to select</Text>
            </Box>
          </Box>
        )}

        <Box marginTop={1} flexDirection="column">
          <Text bold>Available Options (codex -h; snapshot 2025-09-03 if unavailable):</Text>
          <Box flexDirection="column" height={optionsListHeight} overflow="hidden">
            {helpLines.map((line, idx) => (
              <Text key={`h-${idx}`}>{line}</Text>
            ))}
          </Box>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text dimColor>⚠️  Options are loaded from `codex -h` when available (falls back to a minimal list).</Text>
          <Text dimColor>Please refer to official docs for the latest valid options.</Text>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>
            Shortcuts: Enter=confirm, Esc=cancel, ←/→=move cursor, Tab=autocomplete
          </Text>
        </Box>
      </Box>
    </Box>
  );
};
