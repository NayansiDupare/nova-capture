# Nova Capture

A Windows desktop app that captures whatever audio is playing on your PC (a lecture on YouTube, a course video, a podcast in VLC), transcribes it, and turns it into a structured, searchable note. Everything is stored locally.

> **Status:** personal project in active development. Phases 1–3 of the [roadmap](./docs/ARCHITECTURE.md#25-build-roadmap) are done: capture → transcription → AI note → review and save. Library and search (Phase 4) and the tray and hotkey (Phase 5) are next.

## How it works

1. **Capture.** A hidden Capture Host window records system playback audio (Electron loopback) and streams it to an Audio Worker process. The worker writes every frame to a spool file on disk, so a crash never loses the recording.
2. **Transcribe.** After you stop, the worker finds speech, splits it into ~30 s chunks at pauses, and transcribes them in parallel with Groq Whisper. Each chunk is saved as soon as it is done.
3. **Write the note.** Gemini writes a Quick Save (under 2 minutes of speech) or a Full Note (summary, key points with timestamps, tags). The answer is checked against a schema, and key points are ground-checked against the transcript.
4. **Review and save.** You edit the note next to the transcript, then save it to a local SQLite database with full-text search.

Every step is a persisted state (`STARTING → LISTENING → STOPPING → TRANSCRIBING → GENERATING → REVIEW → SAVED`), and provider calls run as retryable jobs. If the app closes at any point, it picks up where it left off on the next launch.

## Tech stack

Electron 44 · TypeScript 6 · React 19 · Zustand · Vite / electron-vite · SQLite (`node:sqlite`, FTS5) · zod · Vitest · pnpm workspaces

## Requirements

- Windows 10 or 11
- [Node.js](https://nodejs.org/) 24 or newer
- [pnpm](https://pnpm.io/) 11 (`corepack enable` sets it up from `package.json`)
- API keys for the providers you use:
  - **Groq** (speech-to-text): <https://console.groq.com/keys>. Whisper large-v3 turbo costs about $0.04 per audio hour.
  - **Gemini** (notes): <https://aistudio.google.com/apikey>. `gemini-3.8-flash` costs roughly $0.001–0.005 per note.

## Getting started

```bash
pnpm install
pnpm dev
```

There is no Settings screen yet. To add your API keys, open DevTools in the app window (`Ctrl+Shift+I`) and run:

```js
await window.nova.secrets.set({ id: 'groq', apiKey: 'YOUR_GROQ_KEY' });
await window.nova.secrets.set({ id: 'gemini', apiKey: 'YOUR_GEMINI_KEY' });
```

Keys are encrypted with Windows' `safeStorage` and can never be read back by the UI.

If speech-to-text mishears technical terms (for example "RAC" for "RAG"), add them under **Vocabulary** in the panel. They are sent to Whisper as a spelling hint and to Gemini, which uses your spelling in the note. Then play some audio, press **Start**, then **Stop**, and review the note when it appears.

Your data lives in `%APPDATA%\Nova Capture` (the database `nova-capture.db` and the `spool` folder with recorded audio).

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Run the desktop app in development mode |
| `pnpm build` | Production build |
| `pnpm typecheck` | TypeScript checks across all packages |
| `pnpm lint` | ESLint |
| `pnpm format` | Prettier |
| `pnpm test` | Unit, pipeline, repository and contract tests (no network, no audio hardware) |
| `pnpm test:coverage` | Tests with coverage thresholds (what CI runs) |

Before committing, run `pnpm typecheck && pnpm lint && pnpm test`.

## Project structure

```
apps/desktop/src/
  main/        Trusted Node process: session orchestrator, IPC, database, providers, job queue
  preload/     Narrow contextBridge APIs, one per window
  renderer/    React main UI and the Capture Host page
  worker/      Audio Worker (utility process): spool writer and speech analysis
packages/core/ Pure TypeScript domain: state machine, zod schemas, prompts, chunk math, test fakes
fixtures/      Recorded provider responses for contract tests
docs/          PRD, architecture, ADRs, code style, testing, design system, security
spikes/        Throwaway Phase 0 prototypes (never imported)
```

## Documentation

- [Product requirements](./docs/PRD.md)
- [Architecture](./docs/ARCHITECTURE.md) and [decision records](./docs/adr/)
- [Testing strategy](./docs/TESTING.md)
- [Code style](./docs/CODE_STYLE.md) and [design system](./docs/DESIGN_SYSTEM.md)
- [Security](./SECURITY.md)
- [Contributor and agent guide](./AGENTS.md)

## Privacy

Audio, transcripts and notes stay on your machine. Only audio chunks (to Groq) and transcript text (to Gemini) leave it, for transcription and note writing. This is built for personal use: a packaged desktop app cannot truly hide API keys, so distributing it would need a backend proxy first (see [ARCHITECTURE §20](./docs/ARCHITECTURE.md#20-optional-backend-only-before-public-distribution)).
