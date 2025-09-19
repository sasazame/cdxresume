import { detectCodexSupport, resetCodexSupportCacheForTests } from '../utils/codexSupport.js';

describe('detectCodexSupport', () => {
  beforeEach(() => {
    resetCodexSupportCacheForTests();
  });

  it('treats codex >= 0.36.0 as supporting resume command via version check', () => {
    const support = detectCodexSupport('Usage: codex [options]', 'Codex CLI 0.36.0');
    expect(support.supportsResumeCommand).toBe(true);
    expect(support.supportsResumeFlag).toBe(false);
    expect(support.supportsSessionIdFlag).toBe(false);
  });

  it('detects legacy resume flag and session-id flag from help text', () => {
    const helpText = `
      Usage: codex [options]
        -r, --resume <id>         Resume a conversation by session ID
            --session-id <uuid>   Start a conversation with a session ID
    `;
    const support = detectCodexSupport(helpText, 'Codex CLI 0.35.1');
    expect(support.supportsResumeCommand).toBe(false);
    expect(support.supportsResumeFlag).toBe(true);
    expect(support.supportsSessionIdFlag).toBe(true);
  });

  it('detects resume command from help text even without version override', () => {
    const helpText = `
      Usage: codex resume [session-id]
        resume [session-id]    Resume a conversation
    `;
    const support = detectCodexSupport(helpText);
    expect(support.supportsResumeCommand).toBe(true);
  });
});
