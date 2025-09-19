import { execSync } from 'child_process';

export interface CodexSupport {
  supportsResumeCommand: boolean;  // codex resume [sessionId]
  supportsResumeFlag: boolean;     // --resume [sessionId]
  supportsContinueFlag: boolean;   // --continue
  supportsSessionIdFlag: boolean;  // --session-id <uuid>
}

let cached: CodexSupport | null = null;

function parseVersionTuple(version: string): [number, number, number] {
  const match = version.trim().match(/(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return [0, 0, 0];
  return [match[1], match[2], match[3]].map((part) => (part ? parseInt(part, 10) : 0)) as [number, number, number];
}

function isVersionAtLeast(version: string, minimum: string): boolean {
  const currentParts = parseVersionTuple(version);
  const minimumParts = parseVersionTuple(minimum);
  for (let i = 0; i < minimumParts.length; i += 1) {
    if (currentParts[i] > minimumParts[i]) return true;
    if (currentParts[i] < minimumParts[i]) return false;
  }
  return true;
}

export function detectCodexSupport(helpOverride?: string, versionOverride?: string): CodexSupport {
  const shouldCache = !helpOverride && !versionOverride;
  if (shouldCache && cached) return cached;

  let help = helpOverride ?? '';
  let versionInfo = versionOverride ?? '';

  if (!help) {
    try {
      help = execSync('codex --help', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 });
    } catch {
      const result: CodexSupport = {
        supportsResumeCommand: false,
        supportsResumeFlag: false,
        supportsContinueFlag: false,
        supportsSessionIdFlag: false
      };
      if (shouldCache) cached = result;
      return result;
    }
  }

  if (!versionInfo) {
    try {
      versionInfo = execSync('codex --version', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 });
    } catch {
      versionInfo = '';
    }
  }

  const normalizedHelp = help.toLowerCase();
  const supportsResumeCommandHelp = /(^|\n)\s*resume\s+(?:\[|<)/.test(normalizedHelp) || /usage:\s*codex\s+resume\b/.test(normalizedHelp);
  const supportsResumeFlag = /\b--resume\b/.test(normalizedHelp) || /(^|\n)\s*-\s*r(?:\b|,)/.test(normalizedHelp);
  const supportsContinueFlag = /\b--continue\b/.test(normalizedHelp) || /(^|\n)\s*-\s*c(?:\b|,)/.test(normalizedHelp);
  const supportsSessionIdFlag = /(^|\n)\s*--session-id\b/.test(normalizedHelp) || /--session-id=/.test(normalizedHelp);

  const versionMatch = versionInfo.match(/(\d+\.\d+\.\d+)/);
  const supportsResumeCommandVersion = versionMatch ? isVersionAtLeast(versionMatch[1], '0.36.0') : false;
  const supportsResumeCommand = supportsResumeCommandHelp || supportsResumeCommandVersion;

  const result: CodexSupport = {
    supportsResumeCommand,
    supportsResumeFlag,
    supportsContinueFlag,
    supportsSessionIdFlag
  };

  if (shouldCache) cached = result;
  return result;
}

export function resetCodexSupportCacheForTests(): void {
  cached = null;
}
