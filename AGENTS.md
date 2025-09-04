# Repository Guidelines

## Project Structure & Module Organization
- `src/` — TypeScript source (CLI, Ink TUI, utils). Entry: `src/cli.tsx`; app: `src/App.tsx`.
- `src/components/` — Ink UI components (Preview, List, CommandEditor).
- `src/utils/` — Helpers (conversationReader, messageUtils, configLoader).
- `src/types/` — Shared TypeScript types.
- `src/__tests__/` — Jest tests for units and UI snapshots.
- `dist/` — Compiled JS output (published to npm).
- `docs/` — Additional docs; Claude mapping kept for historical reference.
- Config path: `~/.config/cdxresume/config.toml`. Codex logs: `~/.codex/sessions/YYYY/MM/DD/*.jsonl`.

## Build, Test, and Development Commands
- `npm run dev` — Run the CLI in watch mode (tsx).
- `npm run build` — Compile TypeScript to `dist/`.
- `npm test` — Run Jest tests.
- `npm run lint` — ESLint + @typescript-eslint rules.
- `npm run typecheck` — TypeScript type-only check.

Example: `npm run dev -- --help` to preview CLI help.

## Coding Style & Naming Conventions
- Language: TypeScript (ESM). Indentation: 2 spaces.
- Prefer explicit types; avoid `any` (tests may relax this).
- Linting: ESLint + @typescript-eslint; fix warnings before PR when feasible.
- File names: `PascalCase` for React components, `camelCase` for utils.

## Testing Guidelines
- Framework: Jest + ink-testing-library for Ink components.
- Place tests in `src/__tests__/`, mirroring file names (e.g., `Foo.test.tsx`).
- Keep tests hermetic: no network, no real filesystem writes.
- Preview behavior: tool results are hidden; Full View renders apply_patch diffs with colors.

## Commit & Pull Request Guidelines
- Commit style (examples):
  - `feat: add full-view patch coloring`
  - `fix: hide tool results in preview`
  - `docs: update README disclaimer`
  - `chore: regenerate package-lock`
  - `test: align ConversationPreview expectations`
- Branch strategy: default is `develop`; release from `master`.
- PRs should include: brief description, rationale, screenshots/recordings for UI changes, and reference issues.

## Security & Configuration Tips
- Do not commit secrets or local paths beyond examples.
- Resume uses Codex experimental flag; behavior may change upstream.
- When adding parsers, be defensive against malformed JSONL (use try/catch and input validation).

