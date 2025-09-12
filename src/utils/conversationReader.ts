import { readdir, readFile, stat } from 'fs/promises';
import { join, basename } from 'path';
import { homedir } from 'os';
import type { Conversation, Message, ContentPart } from '../types.js';
import { extractMessageText } from './messageUtils.js';
import { getCodexVersion, isCodexNewRolloutFormat } from './codexVersion.js';

const CODEX_SESSIONS_DIR = join(homedir(), '.codex', 'sessions');
// For now we intentionally do NOT rely on history.jsonl. We selectively parse
// either the legacy format (pre-0.32) or the new rollout format (0.32+).

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
  const version = getCodexVersion();
  const useNew = isCodexNewRolloutFormat(version);
  const all = useNew
    ? await collectNewFormatConversations()
    : await collectLegacyFormatConversations();

  const filtered = options.currentDirFilter ? all.filter(c => c.projectPath === options.currentDirFilter) : all;
  filtered.sort((a, b) => b.endTime.getTime() - a.endTime.getTime());

  const total = filtered.length;
  const start = Math.min(options.offset, total);
  const end = Math.min(start + options.limit, total);
  return { conversations: filtered.slice(start, end), total };
}

export async function getAllConversations(currentDirFilter?: string): Promise<Conversation[]> {
  try {
    const version = getCodexVersion();
    const useNew = isCodexNewRolloutFormat(version);
    const list = useNew
      ? await collectNewFormatConversations()
      : await collectLegacyFormatConversations();
    const filtered = currentDirFilter ? list.filter(c => c.projectPath === currentDirFilter) : list;
    return filtered.sort((a, b) => b.endTime.getTime() - a.endTime.getTime());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function collectLegacyFormatConversations(): Promise<Conversation[]> {
  const conversations: Conversation[] = [];
  try {
    const years = await readdir(CODEX_SESSIONS_DIR);
    for (const year of years) {
      const yearPath = join(CODEX_SESSIONS_DIR, year);
      let months: string[] = [];
      try { months = await readdir(yearPath); } catch { continue; }
      for (const month of months) {
        const monthPath = join(yearPath, month);
        let days: string[] = [];
        try { days = await readdir(monthPath); } catch { continue; }
        for (const day of days) {
          const dayPath = join(monthPath, day);
          let files: string[] = [];
          try { files = await readdir(dayPath); } catch { continue; }
          const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
          for (const file of jsonlFiles) {
            const filePath = join(dayPath, file);
            // For legacy parser, skip files that are clearly new-format (fast check first line)
            const isNew = await isNewFormatFile(filePath);
            if (isNew) continue;
            const conv = await readConversationLegacy(filePath);
            if (conv) conversations.push(conv);
          }
        }
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return conversations;
}

async function collectNewFormatConversations(): Promise<Conversation[]> {
  const conversations: Conversation[] = [];
  try {
    const years = await readdir(CODEX_SESSIONS_DIR);
    for (const year of years) {
      const yearPath = join(CODEX_SESSIONS_DIR, year);
      let months: string[] = [];
      try { months = await readdir(yearPath); } catch { continue; }
      for (const month of months) {
        const monthPath = join(yearPath, month);
        let days: string[] = [];
        try { days = await readdir(monthPath); } catch { continue; }
        for (const day of days) {
          const dayPath = join(monthPath, day);
          let files: string[] = [];
          try { files = await readdir(dayPath); } catch { continue; }
          const jsonlFiles = files.filter(f => f.endsWith('.jsonl'));
          for (const file of jsonlFiles) {
            const filePath = join(dayPath, file);
            const isNew = await isNewFormatFile(filePath);
            if (!isNew) continue;
            const conv = await readConversationNew(filePath);
            if (conv) conversations.push(conv);
          }
        }
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return conversations;
}

async function readConversationLegacy(filePath: string): Promise<Conversation | null> {
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
    console.error(`Error reading legacy conversation file ${filePath}:`, error);
    return null;
  }
}

async function readConversationNew(filePath: string): Promise<Conversation | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n').filter(l => l.trim());
    if (lines.length === 0) return null;

    interface NewLineBase { timestamp?: string; type?: string; payload?: unknown }
    interface SessionMetaPayload { id?: string; timestamp?: string; cwd?: string; instructions?: string; git?: { branch?: string; repository_url?: string } }
    // ResponseItem payloads are variant; we'll treat them as 'any' in parsing logic below.

    let sessionId = '';
    let startTimestamp = new Date();
    let cwd = '';
    let repoUrl: string | undefined;
    let gitBranch: string | undefined;

    // Parse session_meta from the first line
    try {
      const first = JSON.parse(lines[0]) as NewLineBase;
      if (first && first.type === 'session_meta' && first.payload && typeof first.payload === 'object') {
        const p = first.payload as SessionMetaPayload;
        sessionId = typeof p.id === 'string' ? p.id : '';
        if (typeof p.timestamp === 'string') startTimestamp = new Date(p.timestamp);
        cwd = typeof p.cwd === 'string' ? p.cwd : '';
        if (p.git) {
          if (typeof p.git.repository_url === 'string') repoUrl = p.git.repository_url;
          if (typeof p.git.branch === 'string') gitBranch = p.git.branch;
        }
      } else {
        // Not a new-format file
        return null;
      }
    } catch {
      return null;
    }

    const messages: Message[] = [];
    let counter = 0;

    // Iterate remaining lines
    for (let i = 1; i < lines.length; i++) {
      let parsed: unknown;
      try { parsed = JSON.parse(lines[i]); } catch { continue; }
      if (!parsed || typeof parsed !== 'object') continue;
      const data = parsed as NewLineBase;
      const ts = typeof data.timestamp === 'string' ? data.timestamp : new Date(startTimestamp.getTime() + counter).toISOString();

      if (data.type === 'response_item' && data.payload && typeof data.payload === 'object') {
        const payload = data.payload as Record<string, unknown>;
        const pType = typeof payload.type === 'string' ? (payload.type as string).toLowerCase() : '';

        // 1) Chat messages (user/assistant)
        if (pType === 'message' && (payload.role === 'user' || payload.role === 'assistant')) {
          // Hide initial environment_context messages from history (parity with legacy)
          const contentArr = Array.isArray(payload.content) ? (payload.content as unknown[]) : [];
          const isEnv = contentArr.some((it) => typeof (it as { text?: unknown })?.text === 'string' && ((it as { text?: string }).text as string).includes('<environment_context>'));
          if (isEnv) { counter++; continue; }

          const parts: ContentPart[] = contentArr.map((p): ContentPart | null => {
            const t = typeof (p as { type?: unknown })?.type === 'string' ? ((p as { type?: string }).type as string).toLowerCase() : '';
            const text = typeof (p as { text?: unknown })?.text === 'string' ? (p as { text?: string }).text : undefined;
            if (t === 'input_text') return { type: 'input_text', text };
            if (t === 'output_text') return { type: 'output_text', text };
            if (t === 'text') return { type: 'text', text };
            return null;
          }).filter(Boolean) as ContentPart[];

          messages.push({
            sessionId,
            timestamp: ts,
            type: payload.role,
            message: { role: payload.role, content: parts },
            cwd
          });
          counter++;
          continue;
        }

        // 2) Reasoning — skip (parity with legacy)
        if (pType === 'reasoning') {
          counter++;
          continue;
        }

        // 3) Function/tool calls → map to tool_use
        if (pType === 'function_call') {
          let input: unknown = undefined;
          try {
            if (typeof payload.arguments === 'string') input = JSON.parse(payload.arguments as string);
          } catch { /* ignore */ }
          const name = typeof payload.name === 'string' ? (payload.name as string) : 'tool';
          const callId = typeof payload.call_id === 'string' ? (payload.call_id as string) : undefined;
          messages.push({
            sessionId,
            timestamp: ts,
            type: 'assistant',
            message: { role: 'assistant', content: [{ type: 'tool_use', name, input, tool_use_id: callId }] as ContentPart[] },
            cwd
          });
          counter++;
          continue;
        }

        if (pType === 'function_call_output') {
          // We deliberately do not render stdout/stderr in preview (parity with legacy)
          messages.push({
            sessionId,
            timestamp: ts,
            type: 'assistant',
            message: { role: 'assistant', content: [{ type: 'tool_result' }] as ContentPart[] },
            cwd,
            toolUseResult: { content: 'tool call finished' }
          });
          counter++;
          continue;
        }

        if (pType === 'custom_tool_call') {
          const name = typeof payload.name === 'string' ? `custom:${payload.name as string}` : 'custom_tool';
          let input: unknown = undefined;
          try {
            if (typeof payload.input === 'string') input = JSON.parse(payload.input as string);
          } catch { input = payload.input as unknown; }
          const callId = typeof payload.call_id === 'string' ? (payload.call_id as string) : undefined;
          messages.push({
            sessionId,
            timestamp: ts,
            type: 'assistant',
            message: { role: 'assistant', content: [{ type: 'tool_use', name, input, tool_use_id: callId }] as ContentPart[] },
            cwd
          });
          counter++;
          continue;
        }

        if (pType === 'custom_tool_call_output') {
          messages.push({
            sessionId,
            timestamp: ts,
            type: 'assistant',
            message: { role: 'assistant', content: [{ type: 'tool_result' }] as ContentPart[] },
            cwd,
            toolUseResult: { content: 'tool call finished' }
          });
          counter++;
          continue;
        }

        if (pType === 'local_shell_call') {
          // Map to [Tool: shell] with command vector if available
          const action = (payload.action as Record<string, unknown>) || {};
          const command = Array.isArray(action.command) ? (action.command as unknown[]) : undefined;
          messages.push({
            sessionId,
            timestamp: ts,
            type: 'assistant',
            message: { role: 'assistant', content: [{ type: 'tool_use', name: 'shell', input: { command } }] as ContentPart[] },
            cwd
          });
          counter++;
          continue;
        }

        if (pType === 'web_search_call') {
          const action = (payload.action as Record<string, unknown>) || {};
          const query = typeof action.query === 'string' ? (action.query as string) : undefined;
          messages.push({
            sessionId,
            timestamp: ts,
            type: 'assistant',
            message: { role: 'assistant', content: [{ type: 'tool_use', name: 'web_search', input: { query } }] as ContentPart[] },
            cwd
          });
          counter++;
          continue;
        }

        // Other response_item variants — ignore for now to keep parity/noise low
        counter++;
        continue;
      }

      // Skip event_msg lines in new format (parity with legacy which hid tool output details)
      if (data.type === 'event_msg') { counter++; continue; }
    }

    if (messages.length === 0) return null;

    const startTime = startTimestamp;
    let endTime = startTime;
    try { const s = await stat(filePath); endTime = s.mtime; } catch { /* ignore */ }
    const projectName = projectNameFromRepoUrl(repoUrl);

    return {
      sessionId,
      sourcePath: filePath,
      projectPath: cwd,
      projectName,
      gitBranch: gitBranch || '-',
      messages,
      firstMessage: extractMessageText(messages.find(m => m.type === 'user')?.message?.content) || '',
      lastMessage: extractMessageText(messages.filter(m => m.type === 'user').slice(-1)[0]?.message?.content) || '',
      startTime,
      endTime
    };
  } catch (error) {
    console.error(`Error reading new-format conversation file ${filePath}:`, error);
    return null;
  }
}

async function isNewFormatFile(filePath: string): Promise<boolean> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const first = content.split('\n').find(l => l.trim());
    if (!first) return false;
    const obj = JSON.parse(first) as { type?: string };
    return obj && obj.type === 'session_meta';
  } catch {
    return false;
  }
}

export function formatConversationSummary(conversation: Conversation): string {
  const firstMessagePreview = conversation.firstMessage
    .replace(/\n/g, ' ')
    .substring(0, 80)
    .trim();
  return `${firstMessagePreview}${conversation.firstMessage.length > 80 ? '...' : ''}`;
}
