import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { format } from 'date-fns';
import type { Conversation } from '../types.js';
import { extractMessageText } from '../utils/messageUtils.js';

// Type definitions for tool inputs
interface TodoWriteInput {
  todos?: Array<{
    id: string;
    content: string;
    status: string;
    priority: string;
  }>;
}

interface EditInput {
  filePath?: string;
  file_path?: string;
  oldString?: string;
  old_string?: string;
  newString?: string;
  new_string?: string;
}

interface ReadInput {
  filePath?: string;
  file_path?: string;
  offset?: number;
  limit?: number;
}

interface BashInput {
  command?: string;
  cmd?: string;
}

interface GrepInput {
  pattern?: string;
  glob?: string;
  path?: string;
}

interface GlobInput {
  pattern?: string;
}

interface MultiEditInput {
  filePath?: string;
  file_path?: string;
  edits?: Array<{
    oldString?: string;
    old_string?: string;
    newString?: string;
    new_string?: string;
  }>;
}

type MessageContentItem = {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  thinking?: string;
};

interface ConversationPreviewFullProps {
  conversation: Conversation | null;
  statusMessage?: string | null;
  hideOptions?: string[];
}

export const ConversationPreviewFull: React.FC<ConversationPreviewFullProps> = ({ conversation, statusMessage, hideOptions = [] }) => {
  const [scrollOffset, setScrollOffset] = useState(0);

  // Filter messages based on hideOptions
  const filteredMessages = conversation ? conversation.messages.filter(msg => {
    if (!msg || (!msg.message && !msg.toolUseResult)) {
      return false;
    }
    // Hide tool result-only messages entirely
    if (msg.toolUseResult) return false;
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
      // Just scroll to the end
      setScrollOffset(Math.max(0, filteredMessages.length - 1));
    } else {
      setScrollOffset(0);
    }
  }, [conversation?.sessionId, filteredMessages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Disable all keyboard navigation in full view - only mouse scroll works
  useInput(() => {
    // Do nothing - keyboard navigation is disabled in full view
  });

  if (!conversation) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="gray">No conversation selected</Text>
      </Box>
    );
  }

  // Show all messages from scroll offset onwards, let terminal handle overflow
  const visibleMessages = filteredMessages.slice(scrollOffset);

  return (
    <Box flexDirection="column">
      {visibleMessages.map((msg, index) => {
          // Skip messages without proper structure
          if (!msg || (!msg.message && !msg.toolUseResult)) {
            return null;
          }
          
          const isUser = msg.type === 'user';
          let content = '';
          
          // Handle different message formats
          if (msg.message && msg.message.content) {
            // Check if content contains tool_use
            const messageContent = msg.message.content;
            if (Array.isArray(messageContent)) {
              // Collect all content parts
              const contentParts: string[] = [];
              
              // Check for thinking content
              const thinkingItem = messageContent.find((item: MessageContentItem) => item.type === 'thinking');
              if (thinkingItem && thinkingItem.thinking) {
                contentParts.push(`[Thinking...]\n${thinkingItem.thinking.trim()}`);
              }
              
              // Check for regular text content
              const textItems = messageContent.filter((item: MessageContentItem) => item.type === 'text');
              textItems.forEach((item: MessageContentItem) => {
                if (item.text) {
                  contentParts.push(item.text);
                }
              });
              
              // Check for tool use
              const toolUse = messageContent.find((item: MessageContentItem) => item.type === 'tool_use');
              if (toolUse) {
                // Format tool use based on tool name
                if (toolUse.name === 'TodoWrite') {
                  const input = toolUse.input as TodoWriteInput;
                  if (input?.todos) {
                    const todos = input.todos;
                    const todoSummary = todos.map((todo) => 
                      `  ${todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '→' : '○'} ${todo.content}`
                    ).join('\n');
                    contentParts.push(`[Tool: TodoWrite]\n${todoSummary}`);
                  } else {
                    contentParts.push(`[Tool: TodoWrite]`);
                  }
                } else if (toolUse.name === 'Edit') {
                  const input = toolUse.input as EditInput;
                  const filePath = input?.filePath || input?.file_path || 'file';
                  const oldStr = input?.oldString || input?.old_string || '';
                  const newStr = input?.newString || input?.new_string || '';
                  contentParts.push(`[Tool: Edit] ${filePath}\nOld:\n${oldStr}\nNew:\n${newStr}`);
                } else if (toolUse.name === 'Read') {
                  const input = toolUse.input as ReadInput;
                  const filePath = input?.filePath || input?.file_path || 'file';
                  const lineInfo = input?.offset ? ` (lines ${input.offset}-${input.offset + (input.limit || 50)})` : '';
                  contentParts.push(`[Tool: Read] ${filePath}${lineInfo}`);
                } else if (toolUse.name === 'Bash') {
                  const input = toolUse.input as BashInput;
                  contentParts.push(`[Tool: Bash] ${input?.command || input?.cmd || ''}`);
                } else if (toolUse.name === 'Grep') {
                  const input = toolUse.input as GrepInput;
                  contentParts.push(`[Tool: Grep] pattern: "${input?.pattern || ''}" in ${input?.glob || input?.path || '.'}`);
                } else if (toolUse.name === 'Glob') {
                  const input = toolUse.input as GlobInput;
                  contentParts.push(`[Tool: Glob] pattern: "${input?.pattern || ''}"`);
                } else if (toolUse.name === 'MultiEdit') {
                  const input = toolUse.input as MultiEditInput;
                  const filePath = input?.filePath || input?.file_path || 'file';
                  const edits = input?.edits || [];
                  const editSummary = edits.map((edit, i: number) => 
                    `Edit ${i + 1}:\nOld:\n${edit.oldString || edit.old_string || ''}\nNew:\n${edit.newString || edit.new_string || ''}`
                  ).join('\n\n');
                  contentParts.push(`[Tool: MultiEdit] ${filePath}\n${editSummary}`);
                } else if (toolUse.name === 'shell' && toolUse.input && (toolUse.input as any).command) {
                  const cmd = (toolUse.input as any).command;
                  if (Array.isArray(cmd) && cmd[0] === 'apply_patch' && typeof cmd[1] === 'string') {
                    const patch = cmd[1] as string;
                    contentParts.push(`[Tool: apply_patch]`);
                    contentParts.push(patch);
                  } else if (Array.isArray(cmd)) {
                    contentParts.push(`[Tool: shell] ${cmd.join(' ')}`);
                  } else if (typeof cmd === 'string') {
                    contentParts.push(`[Tool: shell] ${cmd}`);
                  } else {
                    contentParts.push(`[Tool: shell]`);
                  }
                } else {
                  contentParts.push(`[Tool: ${toolUse.name}] ${JSON.stringify(toolUse.input || {}).substring(0, 100)}...`);
                }
              }
              
              // Join all content parts
              content = contentParts.join('\n\n');
              if (!content) {
                content = extractMessageText(messageContent);
              }
            } else {
              content = extractMessageText(messageContent);
            }
          } else if (msg.toolUseResult) {
            // Handle tool result messages
            const result = msg.toolUseResult;
            if (result.oldTodos && result.newTodos) {
              // TodoWrite result
              const changes = result.newTodos.filter((newTodo) => {
                const oldTodo = result.oldTodos?.find((old) => old.id === newTodo.id);
                return !oldTodo || oldTodo.status !== newTodo.status || oldTodo.content !== newTodo.content;
              });
              content = `[TodoWrite Result] ${changes.length} todos updated`;
            } else if (result.file || result.filePath) {
              // Read result
              const filePath = result.file?.filePath || result.filePath;
              content = `[Read Result] ${filePath} (${result.file?.numLines || result.numLines || 0} lines)`;
            } else if (result.oldString && result.newString) {
              // Edit result
              content = `[Edit Result] ${result.filePath || 'file'} modified`;
            } else if (result.stdout || result.stderr) {
              // Do not render raw Tool Output in full view to avoid layout breaks
              content = `[Tool Result]`;
            } else if (result.filenames && Array.isArray(result.filenames)) {
              const fileList = result.filenames.slice(0, 5).join('\n  ');
              const moreCount = result.filenames.length > 5 ? `\n  ... and ${result.filenames.length - 5} more` : '';
              content = `[Search Results: ${result.filenames.length} files]\n  ${fileList}${moreCount}`;
            } else {
              content = `[Tool Result] ${JSON.stringify(result).substring(0, 100)}...`;
            }
          }
          
          const timestamp = new Date(msg.timestamp);
          
          // Skip if timestamp is invalid
          if (isNaN(timestamp.getTime())) {
            return null;
          }
          
          
          const roleText = isUser ? 'User' : 'Assistant';
          const timeText = format(timestamp, 'HH:mm:ss');
          
          // Use a combination of timestamp and index for unique key
          const uniqueKey = `${msg.timestamp}-${scrollOffset + index}`;
          
          return (
            <Box key={uniqueKey} flexDirection="column">
              <Text>
                <Text color={isUser ? 'cyan' : 'green'} bold>[{roleText}]</Text>
                <Text dimColor> ({timeText})</Text>
              </Text>
              {(() => {
                const lines = content.split('\n');
                let inPatch = false;
                return lines.map((line, lineIndex) => {
                  // Enter/exit patch blocks explicitly
                  if (line.startsWith('*** Begin Patch')) {
                    inPatch = true;
                  }
                  const isEndPatch = line.startsWith('*** End Patch');

                  // Label coloring only outside patch blocks
                  const isLabel = line.startsWith('[') && line.includes(']');
                  if (isLabel && !inPatch) {
                    const labelMatch = line.match(/^(\[.*?\])(.*)/);
                    if (labelMatch) {
                      const rendered = (
                        <Text key={`${uniqueKey}-${lineIndex}`}>
                          {'  '}
                          <Text color="yellow">{labelMatch[1]}</Text>
                          <Text>{labelMatch[2]}</Text>
                        </Text>
                      );
                      if (isEndPatch) inPatch = false;
                      return rendered;
                    }
                  }

                  // Colorize only inside patch blocks (or for Begin/End header lines)
                  const colorize = inPatch || line.startsWith('*** Begin Patch') || line.startsWith('*** End Patch');
                  if (colorize) {
                    let color: any = undefined;
                    if (line.startsWith('*** ')) color = 'cyan';
                    else if (line.startsWith('@@')) color = 'magenta';
                    else if (line.startsWith('+')) color = 'green';
                    else if (line.startsWith('-')) color = 'red';
                    const rendered = (
                      <Text key={`${uniqueKey}-${lineIndex}`}>
                        {'  '}
                        <Text color={color}>{line}</Text>
                      </Text>
                    );
                    if (isEndPatch) inPatch = false;
                    return rendered;
                  }

                  const normal = (
                    <Text key={`${uniqueKey}-${lineIndex}`}>
                      {'  '}
                      <Text>{line}</Text>
                    </Text>
                  );
                  if (isEndPatch) inPatch = false;
                  return normal;
                });
              })()}
              <Text> </Text>
            </Box>
          );
        }).filter(Boolean)}
      
      <Text>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</Text>
      {statusMessage ? (
        <Text color="green" bold>{statusMessage}</Text>
      ) : (
        <Text dimColor>
          Toggle: f | Quit: q | Currently supports only terminal scroll (use your mouse!)
        </Text>
      )}
    </Box>
  );
};
