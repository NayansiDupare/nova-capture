# Nova Capture — Code Style Guide

> Version 1.0 · 11 October 2026
> Applies to all TypeScript, React and SQL in this repository. Tooling enforces most of this; this doc explains the rest.

---

## 1. Tooling

| Tool | Purpose |
|---|---|
| **TypeScript** (strict) | Type safety |
| **ESLint** (typescript-eslint, react, react-hooks, import-x) | Linting |
| **Prettier** | Formatting (never argue about it) |
| **pnpm workspaces** | Monorepo package management |
| **lint-staged + husky** | Lint and format on commit |

### Prettier

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "arrowParens": "always"
}
```

### tsconfig essentials

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "useUnknownInCatchVariables": true,
    "verbatimModuleSyntax": true,
    "moduleResolution": "bundler",
    "target": "ES2022"
  }
}
```

---

## 2. Naming

| Thing | Convention | Example |
|---|---|---|
| Files (TS) | kebab-case | `session-machine.ts` |
| Files (React components) | PascalCase | `NoteCard.tsx` |
| Variables, functions | camelCase | `speechRatio`, `buildPrompt()` |
| Types, interfaces, classes | PascalCase | `AudioSource`, `ChunkResult` |
| Constants | UPPER_SNAKE_CASE | `MAX_CHUNK_SEC` |
| Zod schemas | PascalCase + `Schema` | `NoteSchema` |
| IPC channels | `domain:action` | `notes:search` |
| React hooks | `use` prefix | `useSessionState()` |
| Booleans | `is/has/can/should` prefix | `isPaused`, `hasSpeech` |
| DB tables, columns | snake_case | `speech_ratio` |
| Test files | `*.test.ts` next to source | `chunker.test.ts` |

- Units in names when ambiguous: `durationMs`, `chunkSec`, `costUsd`.
- No abbreviations except well-known ones (`id`, `url`, `stt`, `llm`, `ipc`, `vad`, `pcm`).

---

## 3. TypeScript

- **No `any`.** Use `unknown` and narrow. ESLint enforces `no-explicit-any`.
- **No non-null assertions (`!`)** except in tests.
- Prefer `type` for unions and data shapes; `interface` for contracts that classes implement (`AudioSource`, `SpeechToTextProvider`).
- **Derive types from zod schemas** instead of duplicating them:

  ```ts
  export const NoteSchema = z.object({ title: z.string(), summary: z.string() });
  export type Note = z.infer<typeof NoteSchema>;
  ```

- Use **discriminated unions** for states and events:

  ```ts
  type SessionEvent =
    | { type: 'start' }
    | { type: 'stop' }
    | { type: 'fail'; error: string };
  ```

- **Exhaustive switches** with a `never` check:

  ```ts
  default: {
    const _exhaustive: never = event;
    throw new Error(`Unhandled event: ${JSON.stringify(_exhaustive)}`);
  }
  ```

- Use `readonly` for data that shouldn't change; prefer immutable updates.
- Use `as const` for literal config objects.
- Avoid enums; use string literal unions.

---

## 4. Modules and imports

- **Named exports only.** No default exports (except where a tool requires it, e.g. config files).
- Import order (enforced): Node built-ins → external packages → workspace packages (`@nova/core`) → relative.
- Use `import type` for type-only imports.
- No barrel files (`index.ts` re-exporting everything) inside apps; `packages/core` may have one public `index.ts`.
- **Boundary rules (enforced by ESLint `import-x/no-restricted-paths`, `import-x/no-nodejs-modules` and `no-restricted-imports`):**
  - `packages/core` → may not import `electron`, `node:*`, or `apps/*`
  - `renderer/*` → may not import `main/*`, `worker/*`, `electron`, `node:*`
  - Nothing imports from `spikes/`

---

## 5. Functions and structure

- Small functions that do one thing. If a function needs a comment to explain *what* it does, split it.
- **Pure functions in `packages/core`.** Side effects (I/O, time, randomness) are injected:

  ```ts
  export function createJobScheduler(deps: { now: () => number; random: () => number }) { … }
  ```

- Max ~300 lines per file as a guideline. Split by responsibility, not by line count alone.
- Early returns over nested `if`s.
- Prefer object parameters once a function has more than 2–3 arguments.

---

## 6. Error handling

- **Never swallow errors.** Every `catch` logs, rethrows, or converts to a typed result.
- Use typed error classes for expected failures:

  ```ts
  export class ProviderError extends Error {
    constructor(
      message: string,
      readonly provider: string,
      readonly retryable: boolean,
      readonly status?: number,
    ) {
      super(message);
      this.name = 'ProviderError';
    }
  }
  ```

- Distinguish **retryable** (network, 429, 5xx) from **non-retryable** (401, invalid input) errors.
- User-facing errors go through the `error:user` IPC event with plain language and an action. Never show stack traces in the UI.
- Validate all external data (IPC payloads, provider responses, settings files, DB JSON columns) with zod at the boundary.

---

## 7. Async

- Always `await` or explicitly handle promises. ESLint: `no-floating-promises`, `no-misused-promises`.
- Use `AbortController` for cancellable work (provider calls, capture start).
- Every network call has a **timeout**.
- Use `Promise.allSettled` when partial failure is acceptable; `Promise.all` only when any failure should fail the whole operation.

---

## 8. React

- Function components only, typed props:

  ```tsx
  type NoteCardProps = { note: NoteSummary; onOpen: (id: string) => void };
  export function NoteCard({ note, onOpen }: NoteCardProps) { … }
  ```

- **No business logic in components.** Components render state and dispatch intents.
- State: **Zustand** stores per domain (`useSessionStore`, `useNotesStore`), fed by IPC events. Local UI state with `useState`.
- Use selectors to avoid unnecessary re-renders: `useSessionStore((s) => s.state)`.
- Styling with Tailwind using design tokens only ([DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md)). No inline hex colors.
- Accessible by default: semantic HTML, labels, `aria-*` for icon buttons.
- Keep components under ~150 lines; extract subcomponents and hooks.

---

## 9. SQL and database

- Raw SQL with `better-sqlite3` prepared statements. **Never build SQL with string concatenation of user input.**
- SQL keywords uppercase, identifiers snake_case.
- All DB access goes through repositories (`NotesRepo`, etc.).
- Multi-step writes in a transaction (`db.transaction(() => { … })`).
- Migrations: `NNN_description.sql`, forward-only, never edited after merge.

---

## 10. Logging

- Use the shared logger, never `console.log` in committed code (ESLint `no-console`, except in `spikes/` and scripts).
- Structured logs with a message and a context object:

  ```ts
  log.info('chunk transcribed', { sessionId, chunkIndex, durationMs, provider });
  ```

- Never log API keys, auth headers or transcript text at default levels.

---

## 11. Comments and docs

- Comment **why**, not what.
- TSDoc on all exported functions and interfaces in `packages/core`.
- `TODO(chip): …` with a reason; no orphan TODOs.
- Significant decisions → ADR in `docs/adr/NNNN-title.md`.

---

## 12. Git

### Branches
- `main` is always releasable.
- Feature branches: `feat/short-description`, `fix/…`, `chore/…`, `docs/…`.

### Commits: Conventional Commits

```
<type>(<scope>): <short summary>

<optional body: what and why>
```

**Types:** `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `chore`, `build`, `ci`
**Scopes:** `core`, `main`, `worker`, `capture`, `ui`, `overlay`, `db`, `ipc`, `stt`, `llm`, `eval`

Examples:
```
feat(worker): add energy-based VAD with configurable threshold
fix(stt): retry on 429 with exponential backoff
test(core): cover invalid session transitions
```

- Keep commits small and focused. Squash noisy WIP commits before merging.
