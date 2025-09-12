# Changelog

All notable changes to this project are documented here.

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.3] - 2025-09-12

### Added
- Support for Codex 0.32.0+ rollout JSONL (session_meta/response_item) parsing; user/assistant messages and tool calls are rendered comparable to legacy logs.
- Detection of native Codex resume flags; prefer `--resume <sessionId>` / `--session-id <uuid>` when available; fall back to `-c experimental_resume=<path>` on older Codex builds.
- When Codex version cannot be detected, cdxresume probes local logs to select the matching format; if inconclusive, it shows a notice and starts a new session.

### Changed
- Read only the format that matches the installed Codex version (legacy <0.32 vs new ≥0.32); no cross‑format conversion yet.
- Safer process launching (no shell) and clearer error hints during resume/new.
## [0.1.2] - 2025-09-03

Hotfix: prevent stray characters right after resume/new.

### Fixed
- TTY: remove full terminal reset (ESC c/RIS) that can elicit terminal responses.
- TTY: drain pending input from /dev/tty (POSIX) before launching Codex to avoid leaking buffered bytes.

## [0.1.1] - 2025-09-03

Patch release with packaging and stability improvements.

### Changed
- Package: include README/CHANGELOG/LICENSE in published tarball.
- Preview: ensure tail lines are visible based on actual viewport height.
- TTY: strengthen reset before launching Codex to improve IME/input stability.

## [0.1.0] - 2025-09-03

Initial release of cdxresume — a TUI for browsing and resuming OpenAI Codex CLI conversations.

### Added
- Conversation list with pagination and quick navigation.
- Conversation preview with compact rendering and status line.
- Resume selected session (passes `experimental_resume` to Codex CLI).
- Start a new session in the selected project directory.
- Inline command editor to tweak Codex CLI options before launching.
- Hide options to filter tool/thinking/user/assistant lines.
- Full conversation view (experimental) toggle.
- Configurable keybindings via `~/.config/cdxresume/config.toml`.

### Compatibility and UX
- Defensive parsing for malformed JSONL logs.
- TTY reset on launch to avoid terminal/IME instability across platforms.

## Project Provenance

cdxresume was started by forking the prior project “ccresume” at its
`v1.0.0` state and then re-initializing under a new name and versioning scheme.
Past history and releases before cdxresume 0.1.0 belong to cccresume.

- ccresume changelog: https://github.com/sasazame/ccresume/blob/develop/CHANGELOG.md
- Fork point: ccresume v1.0.0
