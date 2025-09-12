import { execSync } from 'child_process';

export interface CodexSupport {
  supportsResumeFlag: boolean;      // --resume [sessionId]
  supportsContinueFlag: boolean;    // --continue
  supportsSessionIdFlag: boolean;   // --session-id <uuid>
}

let cached: CodexSupport | null = null;

export function detectCodexSupport(): CodexSupport {
  if (cached) return cached;
  let help = '';
  try {
    help = execSync('codex --help', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    // If codex is not available or help fails, assume no flags
    cached = { supportsResumeFlag: false, supportsContinueFlag: false, supportsSessionIdFlag: false };
    return cached;
  }

  const normalized = help.toLowerCase();
  const supportsResumeFlag = /\b--resume\b/.test(normalized) || /\b-\s*r,\s*--resume\b/.test(normalized);
  const supportsContinueFlag = /\b--continue\b/.test(normalized) || /\b-\s*c,\s*--continue\b/.test(normalized);
  const supportsSessionIdFlag = /\b--session-id\b/.test(normalized);

  cached = { supportsResumeFlag, supportsContinueFlag, supportsSessionIdFlag };
  return cached;
}

