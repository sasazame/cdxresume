export interface Message {
  sessionId: string;
  timestamp: string;
  type: 'user' | 'assistant';
  message?: {
    role: 'user' | 'assistant';
    content?: string | ContentPart[];
  };
  cwd: string;
  toolUseResult?: {
    stdout?: string;
    stderr?: string;
    filenames?: string[];
    durationMs?: number;
    interrupted?: boolean;
    isImage?: boolean;
    // TodoWrite results
    oldTodos?: Array<{ id: string; content: string; status: string; priority: string }>;
    newTodos?: Array<{ id: string; content: string; status: string; priority: string }>;
    // Read results
    file?: {
      filePath: string;
      content: string;
      numLines: number;
      startLine: number;
      totalLines: number;
    };
    filePath?: string; // Fallback for different result formats
    numLines?: number;
    // Edit results
    oldString?: string;
    newString?: string;
    originalFile?: string;
    replaceAll?: boolean;
    structuredPatch?: unknown;
    userModified?: boolean;
    // Other tool results
    type?: string;
    content?: string;
    mode?: string;
    numFiles?: number;
    totalDurationMs?: number;
    totalTokens?: number;
    totalToolUseCount?: number;
    usage?: unknown;
  };
}

// Content item parts within a message
export type ContentPart =
  | { type: 'text'; text?: string }
  | { type: 'input_text'; text?: string }
  | { type: 'output_text'; text?: string }
  | { type: 'tool_use'; name?: string; input?: unknown; tool_use_id?: string }
  | { type: 'tool_result' }
  | { type: 'thinking'; thinking?: string };

export interface Conversation {
  sessionId: string;
  sourcePath?: string;
  projectPath: string;
  projectName: string;
  gitBranch?: string | null;
  messages: Message[];
  firstMessage: string;
  lastMessage: string;
  startTime: Date;
  endTime: Date;
}
