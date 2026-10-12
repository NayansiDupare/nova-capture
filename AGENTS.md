# AGENTS.md

Instructions for AI coding agents (and humans) working in this repository. Read this before making changes.

> Related: [PRD.md](./docs/PRD.md) · [ARCHITECTURE.md](./docs/ARCHITECTURE.md) · [CODE_STYLE.md](./docs/CODE_STYLE.md) · [SECURITY.md](./SECURITY.md) · [TESTING.md](./docs/TESTING.md) · [DESIGN_SYSTEM.md](./docs/DESIGN_SYSTEM.md)

---

## 1. Project overview

**Nova Capture** is a Windows desktop app (Electron + TypeScript + React) that captures system playback audio, transcribes it with a cloud STT provider, generates a structured note with an LLM, and stores it locally in SQLite with full-text search.

Top priority is **reliability: a capture is never lost.** When in doubt, choose the option that preserves user data.

---

## 2. Repository map

```
nova-capture/
├── apps/desktop/src/
│   ├── main/          Trusted Node process: orchestrator, IPC, DB, providers, windows, tray, hotkeys
│   ├── preload/       contextBridge APIs, one file per window type
│   ├── renderer/
│   │   ├── main-ui/       React app (screens, components, stores)
│   │   ├── overlay/       Tiny React bundle for the floating control
│   │   └── capture-host/  Bare page: getDisplayMedia + AudioWorklet, no framework
│   └── worker/        Audio Worker (utilityProcess): ring buffer, VAD, chunker, spool
├── packages/core/     Pure TypeScript domain: types, zod schemas, state machine, prompts, chunk math
├── packages/eval/     Evaluation harness and clip set
├── contracts/         JSON Schemas shared with future Android app
├── docs/adr/          Architecture Decision Records
└── spikes/            Throwaway prototypes. Never import from here.
```

---

## 3. Commands

```bash
pnpm install              # install all workspace deps
pnpm dev                  # run the desktop app in dev mode (electron-vite)
pnpm build                # production build
pnpm typecheck            # tsc --noEmit across workspaces
pnpm lint                 # eslint
pnpm format               # prettier --write
pnpm test                 # vitest (unit + pipeline + repository)
pnpm test:coverage        # vitest with coverage thresholds (what CI runs)
pnpm test:e2e             # playwright for electron
pnpm eval                 # run eval harness against real providers (costs money!)
```

**Before finishing any task, run:** `pnpm typecheck && pnpm lint && pnpm test`

Never run `pnpm eval` unless explicitly asked. It calls paid APIs.

---

## 4. Hard rules (never break these)

1. **`packages/core` must not import Electron, Node built-ins (`fs`, `path`, etc.), or anything from `apps/`.** It is pure TypeScript.
2. **Renderers never touch Node, SQL, the filesystem, or secrets.** They send intents over IPC and render events.
3. **Every IPC channel is defined once as a zod schema in `packages/core/src/ipc/`** and validated in main before use.
4. **API keys never leave the main process.** `secrets:set` is write-only. No `secrets:get` channel, ever.
5. **Never delete a spool file or transcript before the note is saved.**
6. **Never log transcript text or API keys** at default log levels.
7. **Database migrations are forward-only.** Never edit an existing migration; add a new one.
8. **Audio frames do not go through the main process.** They travel Capture Host → Audio Worker over a MessagePort.
9. **Do not weaken Electron security settings** (`contextIsolation`, `sandbox`, `nodeIntegration`, CSP). See [SECURITY.md](./SECURITY.md).
10. **Do not add dependencies** without stating why in the PR/commit message. Prefer the standard library and existing deps.
11. **Do not import from `spikes/`.**

---

## 5. How to do common tasks

### Add an IPC channel
1. Define request/response zod schemas in `packages/core/src/ipc/channels.ts`.
2. Add a handler in `apps/desktop/src/main/ipc/` that parses input with the schema.
3. Expose one narrow function in the relevant preload file.
4. Add a contract test for the schema.
5. Update the table in ARCHITECTURE §11.

### Add an STT or LLM provider
1. Implement `SpeechToTextProvider` or `LLMProvider` in `apps/desktop/src/main/providers/`.
2. Register it in the provider registry.
3. Add contract tests against **recorded** responses (no live calls in CI).
4. Add timeouts and route errors through the shared retry/backoff helper.
5. Log usage to `usage_log`.

### Change the session state machine
1. Edit the reducer in `packages/core/src/session/`.
2. Add unit tests for every new transition **and** invalid transitions.
3. Make sure the orchestrator persists the new state and recovery handles it.

### Add a database change
1. Create a new numbered migration in `apps/desktop/src/main/db/migrations/`.
2. Update the relevant repository.
3. Add a repository test that migrates from scratch **and** from the previous version.

### Change a prompt
1. Edit the file in `packages/core/src/prompts/` and **bump its version string**.
2. Update snapshot tests for the prompt builder.
3. Note in the commit that `pnpm eval` should be run.

### Add a UI component
1. Follow [DESIGN_SYSTEM.md](./docs/DESIGN_SYSTEM.md) tokens; no hard-coded colors or spacing.
2. Keep business logic out of components; read from Zustand stores fed by IPC events.
3. Make it keyboard-accessible.

---

## 6. Definition of done

A change is done when:

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` pass
- [ ] New logic has tests (see [TESTING.md](./docs/TESTING.md))
- [ ] No new security regressions (see the checklist in [SECURITY.md](./SECURITY.md))
- [ ] Docs updated if behavior, IPC, schema or architecture changed
- [ ] An ADR added in `docs/adr/` for any significant architectural decision
- [ ] Commit follows Conventional Commits (see [CODE_STYLE.md](./docs/CODE_STYLE.md))

---

## 7. Working style for agents

- **Make small, focused changes.** One concern per commit.
- **Read before writing.** Check existing patterns in nearby files and follow them.
- **Ask, don't guess,** when a requirement is ambiguous and the change is hard to undo (schema, IPC contract, file deletion).
- **Explain trade-offs** briefly in the commit or PR description.
- **Do not rewrite unrelated code** or reformat files you didn't otherwise touch.
- **Do not invent APIs.** Verify Electron and library APIs against the pinned version's docs.
- **Prefer fakes over mocks.** Use `FakeAudioSource`, `FakeSTT`, `FakeLLM` from `packages/core/src/testing/`.
- **Never commit secrets,** `.env` files, real audio recordings or personal transcripts.

---

## 8. Glossary

| Term | Meaning |
|---|---|
| **Session** | One capture from start to saved/discarded note |
| **Spool file** | Temp file with all captured audio frames, for crash safety |
| **Chunk** | ~30 s audio window sent to STT |
| **Segment** | A timestamped piece of transcript text |
| **Capture Host** | Hidden window that runs `getDisplayMedia` |
| **Audio Worker** | Utility process that buffers, detects speech, chunks and spools |
| **Quick Save / Full Note** | Short vs. full note modes, chosen by speech duration |
| **Ground check** | Verifying note key points against the transcript |
