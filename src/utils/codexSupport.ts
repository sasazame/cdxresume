import { execSync } from 'child_process';

export interface CodexSupport {
  supportsResumeFlag: boolean;      // --resume [sessionId]
  supportsContinueFlag: boolean;    // --continue
  supportsSessionIdFlag: boolean;   // --session-id <uuid>
}

let cached: CodexSupport | null = null;

export function detectCodexSupport(helpOverride?: string): CodexSupport {
  if (cached) return cached;
  let help = helpOverride ?? '';
  try {
    if (!help) help = execSync('codex --help', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 });
  } catch {
    // If codex is not available or help fails, assume no flags
    cached = { supportsResumeFlag: false, supportsContinueFlag: false, supportsSessionIdFlag: false };
    return cached;
  }

  const normalized = help.toLowerCase();
  const supportsResumeFlag = /\b--resume\b/.test(normalized) || /(^|\n)\s*-\s*r(?:\b|,)/.test(normalized);
  const supportsContinueFlag = /\b--continue\b/.test(normalized) || /(^|\n)\s*-\s*c(?:\b|,)/.test(normalized);
  const supportsSessionIdFlag = /\b--session-id\b/.test(normalized);

  cached = { supportsResumeFlag, supportsContinueFlag, supportsSessionIdFlag };
  return cached;
}
