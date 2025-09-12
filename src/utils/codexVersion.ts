import { execSync } from 'child_process';

export function getCodexVersion(): string | null {
  try {
    const out = execSync('codex --version', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    // Expect a semver-like string, possibly prefixed. Keep simple: first token with digits.
    const m = out.match(/(\d+\.\d+\.\d+(?:-[^\s]+)?)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

export function isCodexNewRolloutFormat(version: string | null): boolean {
  // New format introduced at 0.32.0
  if (!version) return true; // default to new format on unknown
  return compareSemver(version, '0.32.0') >= 0;
}

function compareSemver(a: string, b: string): number {
  // Very small comparator, ignores build metadata.
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

