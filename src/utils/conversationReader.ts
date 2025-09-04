import { readdir, readFile, stat } from 'fs/promises';
import { join, basename } from 'path';
import { homedir } from 'os';
import type { Conversation, Message, ContentPart } from '../types.js';
import { extractMessageText } from './messageUtils.js';

const CODEX_SESSIONS_DIR = join(homedir(), '.codex', 'sessions');

interface PaginationOptions {
  limit: number;
  offset: number;
  currentDirFilter?: string;
}

function extractCwdFromContentText(text: string): string | null {
  const m = text.match(/<cwd>([^<]+)<\/cwd>/);
  return m ? m[1] : null;
}

function projectNameFromRepoUrl(url?: string): string {
  if (!url) return '-';
  const withoutGit = url.replace(/\.git$/, '');
  const parts = withoutGit.split('/');
  if (parts.length < 2) return '-';
  const owner = parts[parts.length - 2];
  const repo = parts[parts.length - 1];
  return `${owner}/${repo}`;
}

export async function getPaginatedConversations(options: PaginationOptions): Promise<{ conversations: Conversation[]; total: number; }> {
  const allFiles: Array<{ path: string; dir: string; mtime: Date }>= [];
  try {
    const years = await readdir(CODEX_SESSIONS_DIR);
    for (const year of years) {
      const yearPath = join(CODEX_SESSIONS_DIR, year);
      let months: string[] = [];
      try { months = await readdir(yearPath); } catch { /* ignore non-dirs */ continue; }
      for (const month of months) {
        const monthPath = join(yearPath, month);
        let days: string[] = [];
        try { days = await readdir(monthPath); } catch { /* ignore non-dirs */ continue; }
        for (const day of days) {
          const dayPath = join(monthPath, day);
          let files: string[] = [];
          try { files = await readdir(dayPath); } catch { /* ignore non-dirs */ continue; }
          const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
          for (const file of jsonlFiles) {
            const filePath = join(dayPath, file);
            const stats = await stat(filePath);
            allFiles.push({ path: filePath, dir: `${year}/${month}/${day}`, mtime: stats.mtime });
          }
        }
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { conversations: [], total: 0 };
    }
    throw error;
  }

  allFiles.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

  const conversations: Conversation[] = [];
  let skippedCount = 0;
  let fileIndex = 0;

  while (skippedCount < options.offset && fileIndex < allFiles.length) {
    const file = allFiles[fileIndex];
    const conv = await readConversation(file.path);
    if (conv) skippedCount++;
    fileIndex++;
  }

  while (conversations.length < options.limit && fileIndex < allFiles.length) {
    const file = allFiles[fileIndex];
    const conv = await readConversation(file.path);
    if (conv) conversations.push(conv);
    fileIndex++;
  }

  return { conversations, total: -1 };
}

export async function getAllConversations(currentDirFilter?: string): Promise<Conversation[]> {
  const conversations: Conversation[] = [];
  try {
    const years = await readdir(CODEX_SESSIONS_DIR);
    for (const year of years) {
      const yearPath = join(CODEX_SESSIONS_DIR, year);
      let months: string[] = [];
      try { months = await readdir(yearPath); } catch { /* ignore */ continue; }
      for (const month of months) {
        const monthPath = join(yearPath, month);
        let days: string[] = [];
        try { days = await readdir(monthPath); } catch { /* ignore */ continue; }
        for (const day of days) {
          const dayPath = join(monthPath, day);
          let files: string[] = [];
          try { files = await readdir(dayPath); } catch { /* ignore */ continue; }
          const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
          for (const file of jsonlFiles) {
            const filePath = join(dayPath, file);
            const conv = await readConversation(filePath);
            if (conv) conversations.push(conv);
          }
        }
      }
    }
    const filtered = currentDirFilter ? conversations.filter(c => c.projectPath === currentDirFilter) : conversations;
    return filtered.sort((a, b) => b.endTime.getTime() - a.endTime.getTime());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function readConversation(filePath: string): Promise<Conversation | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.trim());
    if (lines.length === 0) return null;

    // First line metadata
    let sessionId = basename(filePath).replace('.jsonl', '');
    let startTimestamp = new Date();
    let repoUrl: string | undefined;
    try {
      const meta = JSON.parse(lines[0]);
      if (meta && meta.id) sessionId = meta.id as string;
      if (meta && meta.timestamp) startTimestamp = new Date(meta.timestamp as string);
      if (meta && meta.git && meta.git.repository_url) repoUrl = meta.git.repository_url as string;
    } catch { /* ignore malformed first line */ }

    const messages: Message[] = [];
    let cwdFromIntro: string | null = null;
    let counter = 0;
    // Minimal shape used to parse log lines without using `any`
    interface RawLine {
      type?: string;
      role?: 'user' | 'assistant';
      content?: unknown;
      record_type?: string;
      arguments?: string;
      name?: string;
      call_id?: string;
      output?: string;
    }
    for (const line of lines) {
      let parsed: unknown;
      try { parsed = JSON.parse(line); } catch { continue; }
      if (!parsed || typeof parsed !== 'object') continue;
      const data = parsed as RawLine;
      if (data.record_type === 'state') continue;

      // Skip internal reasoning entries; they are verbose and not user-visible chat
      if (data.type === 'reasoning') continue;

      if (data.type === 'message' && (data.role === 'user' || data.role === 'assistant')) {
        const items: ContentPart[] = Array.isArray(data.content) ? (data.content as ContentPart[]) : [];
        if (data.role === 'user') {
          for (const it of items) {
            if (it && 'text' in it && typeof (it as { text?: string }).text === 'string') {
              const found = extractCwdFromContentText((it as { text?: string }).text as string);
              if (found) { cwdFromIntro = found; break; }
            }
          }
          // Hide initial environment_context messages from history
          const isEnvContext = items.some((it) => 'text' in it && typeof (it as { text?: string }).text === 'string' && ((it as { text?: string }).text as string).includes('<environment_context>'));
          if (isEnvContext) {
            counter++;
            continue;
          }
        }
        const ts = new Date(startTimestamp.getTime() + counter).toISOString();
        messages.push({
          sessionId,
          timestamp: ts,
          type: data.role,
          message: { role: data.role, content: items },
          cwd: cwdFromIntro || ''
        } as Message);
        counter++;
      }

      // Map Codex function calls to tool-use style entries
      if (data.type === 'function_call') {
        const ts = new Date(startTimestamp.getTime() + counter).toISOString();
        let parsedArgs: unknown = undefined;
        try {
          if (typeof data.arguments === 'string') parsedArgs = JSON.parse(data.arguments);
        } catch { /* ignore bad arguments */ }
        const name = typeof data.name === 'string' ? data.name : 'tool';
        messages.push({
          sessionId,
          timestamp: ts,
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'tool_use', name, input: parsedArgs, tool_use_id: data.call_id }] as ContentPart[] },
          cwd: cwdFromIntro || ''
        } as Message);
        counter++;
        continue;
      }

      if (data.type === 'function_call_output') {
        const ts = new Date(startTimestamp.getTime() + counter).toISOString();
        let stdout: string | undefined;
        try {
          if (typeof data.output === 'string') {
            const out = JSON.parse(data.output);
            if (out && typeof out.output === 'string') stdout = out.output;
          }
        } catch { /* ignore parse errors */ }
        messages.push({
          sessionId,
          timestamp: ts,
          type: 'assistant',
          message: { role: 'assistant', content: [{ type: 'tool_result' }] as ContentPart[] },
          cwd: cwdFromIntro || '',
          toolUseResult: stdout ? { stdout } : { content: 'tool call finished' }
        } as Message);
        counter++;
        continue;
      }
    }

    if (messages.length === 0) return null;

    const userMessages = messages.filter(m => m.type === 'user');
    const projectName = projectNameFromRepoUrl(repoUrl);
    const startTime = startTimestamp;
    let endTime = startTime;
    try { const s = await stat(filePath); endTime = s.mtime; } catch { /* ignore */ }

    let gitBranch = '-';
    try {
      const meta = JSON.parse(lines[0]);
      if (meta && meta.git && typeof meta.git.branch === 'string') gitBranch = meta.git.branch || '-';
    } catch { /* ignore */ }

    const projectPath = cwdFromIntro || '';

    return {
      sessionId,
      sourcePath: filePath,
      projectPath,
      projectName,
      gitBranch,
      messages,
      firstMessage: userMessages.length > 0 ? extractMessageText(userMessages[0].message?.content) : '',
      lastMessage: userMessages.length > 0 ? extractMessageText(userMessages[userMessages.length - 1].message?.content) : '',
      startTime,
      endTime
    };
  } catch (error) {
    console.error(`Error reading conversation file ${filePath}:`, error);
    return null;
  }
}

export function formatConversationSummary(conversation: Conversation): string {
  const firstMessagePreview = conversation.firstMessage
    .replace(/\n/g, ' ')
    .substring(0, 80)
    .trim();
  return `${firstMessagePreview}${conversation.firstMessage.length > 80 ? '...' : ''}`;
}
