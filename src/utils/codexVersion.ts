import { execSync } from 'child_process';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export function getCodexVersion(): string | null {
  try {
    const out = execSync('codex --version', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 1500 }).trim();
    // Expect a semver-like string, possibly prefixed. Keep simple: first token with digits.
    const m = out.match(/(\d+\.\d+\.\d+(?:-[^\s]+)?)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export function isCodexNewRolloutFormat(version: string | null): boolean {
  // New format introduced at 0.32.0
  if (!version) return guessFromLocalLogs(); // probe instead of defaulting to new
  return compareSemver(version, '0.32.0') >= 0;
}

function compareSemver(a: string, b: string): number {
  // Very small comparator, ignores pre-release/build metadata (treats 0.32.0-beta == 0.32.0).
  const pa = a.split('-')[0].split('.').map(n => parseInt(n, 10));
  const pb = b.split('-')[0].split('.').map(n => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const da = pa[i] || 0;
    const db = pb[i] || 0;
    if (da > db) return 1;
    if (da < db) return -1;
  }
  return 0;
}

function guessFromLocalLogs(): boolean {
  try {
    // Heuristic 1: if consolidated history.jsonl exists, we assume newer codex
    const history = join(homedir(), '.codex', 'history.jsonl');
    if (existsSync(history)) return true;

    // Heuristic 2: sample one session file and inspect the first line
    const sessionsRoot = join(homedir(), '.codex', 'sessions');
    // Years descending
    const years = safeReadDir(sessionsRoot).sort().reverse();
    for (const y of years) {
      const months = safeReadDir(join(sessionsRoot, y)).sort().reverse();
      for (const m of months) {
        const days = safeReadDir(join(sessionsRoot, y, m)).sort().reverse();
        for (const d of days) {
          const dayPath = join(sessionsRoot, y, m, d);
          const files = safeReadDir(dayPath).filter(f => f.endsWith('.jsonl'));
          if (files.length === 0) continue;
          const fpath = join(dayPath, files.sort().reverse()[0]);
          const first = readFirstLine(fpath);
          if (!first) continue;
          try {
            const obj = JSON.parse(first) as { type?: string };
            return obj?.type === 'session_meta';
          } catch { /* ignore */ }
        }
      }
    }
  } catch { /* ignore */ }
  return false; // default to legacy if inconclusive
}

function safeReadDir(path: string): string[] {
  try { return readdirSync(path); } catch { return []; }
}

function readFirstLine(path: string): string | null {
  try {
    const data = readFileSync(path, 'utf-8');
    const line = data.split('\n').find(l => l.trim());
    return line ? line : null;
  } catch {
    return null;
  }
}
