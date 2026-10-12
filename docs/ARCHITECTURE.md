# Nova Capture — Architecture

> Version 2.1 · 11 October 2026
> Based on Architecture v2 (9 Oct 2026), plus a v1 scope and build roadmap for a solo, resume-focused build.

---

## Table of contents

1. [Goals and constraints](#1-goals-and-constraints)
2. [System context](#2-system-context)
3. [Process and window architecture](#3-process-and-window-architecture)
4. [Repository layout](#4-repository-layout)
5. [Audio capture subsystem](#5-audio-capture-subsystem)
6. [Audio pipeline (Audio Worker)](#6-audio-pipeline-audio-worker)
7. [Speech-to-text subsystem](#7-speech-to-text-subsystem)
8. [Capture session state machine](#8-capture-session-state-machine)
9. [AI pipeline](#9-ai-pipeline)
10. [Data architecture](#10-data-architecture)
11. [IPC contract](#11-ipc-contract)
12. [Renderer architecture](#12-renderer-architecture)
13. [Floating overlay and system integration](#13-floating-overlay-and-system-integration)
14. [Security architecture](#14-security-architecture)
15. [Error handling matrix](#15-error-handling-matrix)
16. [Observability](#16-observability)
17. [Performance and resource budgets](#17-performance-and-resource-budgets)
18. [Testing strategy](#18-testing-strategy)
19. [Build, packaging and release](#19-build-packaging-and-release)
20. [Optional backend](#20-optional-backend-only-before-public-distribution)
21. [Android architecture](#21-android-architecture-later-gated)
22. [Extension points](#22-extension-points)
23. [Key architecture decisions](#23-key-architecture-decisions)
24. [v1 scope: build now vs. defer](#24-v1-scope-build-now-vs-defer)
25. [Build roadmap](#25-build-roadmap)
26. [Resume and showcase checklist](#26-resume-and-showcase-checklist)

---

## 1. Goals and constraints

**Goal:** a Windows desktop app that captures system playback audio on demand, turns it into a transcript, generates a structured note with an LLM, and stores it locally with fast search.

### Quality attributes (priority order)

1. **Reliability.** A capture is never lost. Network or provider failures delay a note; they do not destroy it.
2. **Replaceability.** Audio source, STT provider and LLM provider can each be swapped without touching other layers.
3. **Privacy and security.** Local-first storage, no secrets in renderers, no raw-audio retention by default.
4. **Low footprint.** The idle app uses little CPU and memory, and capture does not disturb the video being watched.
5. **Testability.** Every pipeline stage runs against fixture audio without a real device.

### Constraints

- One developer with TypeScript skills
- Windows first
- Cloud STT and LLM for the MVP
- Android later, as a separate native app

---

## 2. System context

```
+-------------------+            +----------------------------+
|  Any app playing  |            |   Cloud STT provider(s)    |
|  audio (browser,  |            +-------------^--------------+
|  VLC, course...)  |                          | audio chunks (HTTPS)
+---------+---------+                          |
          | system playback audio              |
          v                                    |
+---------------------------------------------------+
|              NOVA CAPTURE (Windows)               |
|   Capture -> Pipeline -> STT -> Notes -> SQLite   |
+----------------------+----------------------------+
                       | transcript text (HTTPS)
                       v
          +----------------------------+
          |     Cloud LLM provider     |
          +----------------------------+
```

There is no Nova backend in the MVP. The app talks directly to providers from the Electron main process. A thin proxy backend is added only before public distribution ([§20](#20-optional-backend-only-before-public-distribution)).

---

## 3. Process and window architecture

Electron is split into one trusted process, several untrusted windows, and one worker process.

```
+------------------------------ MAIN PROCESS (Node, trusted) ------------------------------+
| App lifecycle | Session Orchestrator (state machine) | Job queue | Repositories          |
| Settings + safeStorage | STT/LLM clients | Global hotkey | Tray | Window manager         |
| SQLite (node:sqlite)    | Logger | IPC router with schema validation                     |
+-----+-------------------------+-------------------------+-------------------------------+
      | typed IPC               | typed IPC               | MessagePort + utilityProcess API
      v                         v                         v
+-------------+         +--------------+         +--------------------+       +------------------+
|  Main UI    |         |  Overlay UI  |         |   Capture Host     | PCM   |   Audio Worker   |
|  window     |         |  floating    |         |   hidden window    |------>|  utilityProcess  |
|  React      |         |  button      |         |  getDisplayMedia   |       |  VAD, chunk,     |
|  sandboxed  |         |  React       |         |  + AudioWorklet    |       |  encode, spool   |
+-------------+         +--------------+         +--------------------+       +------------------+
```

### Why this split

| Component | Reason |
|---|---|
| **Capture Host** (hidden window) | Reloading or crashing the main UI never interrupts an active capture. Capture code stays isolated from UI code. |
| **Audio Worker** (utility process) | Buffer handling, VAD and file spooling run off the main process, so the app stays responsive. A worker crash can be restarted without losing the session record. |
| **Main process** | Owns state and secrets. Renderers are views: they send intents and receive events. |
| **Overlay** (separate window) | Needs different window flags (always on top, frameless, non-focusable) and must stay alive when the main window is closed or hidden. |

---

## 4. Repository layout

```
nova-capture/
├── apps/desktop/
│   └── src/
│       ├── main/          orchestrator, ipc, db, providers, windows, tray, hotkeys
│       ├── preload/       contextBridge APIs (one per window type)
│       ├── renderer/      main-ui/, overlay/, capture-host/
│       └── worker/        audio worker (utility process entry)
├── packages/
│   ├── core/              pure TypeScript: types, zod schemas, state machine, prompts, chunk math
│   └── eval/              evaluation harness, 20-clip test set, scoring scripts
├── contracts/             JSON Schema for Note and API shapes (shared with Android)
├── spikes/                phase 0 throwaway prototypes
└── docs/adr/              architecture decision records
```

> **Rule:** `packages/core` must never import Electron or Node-only APIs. This keeps the domain logic testable and portable.

---

## 5. Audio capture subsystem

### 5.1 Interface

```ts
export type AudioFormat = {
  sampleRate: 16000;
  channels: 1;
  encoding: 'pcm_s16le';
};

export interface AudioSource {
  readonly id: string; // 'electron-loopback' | 'native-process'
  listTargets(): Promise<CaptureTarget[]>; // whole system, or specific apps if supported
  start(
    target: CaptureTarget,
    onFrame: (pcm: Int16Array, tsMs: number) => void
  ): Promise<void>;
  stop(): Promise<void>;
  on(event: 'error' | 'ended', cb: (e?: Error) => void): void;
}
```

Every implementation delivers **16 kHz mono 16-bit PCM frames of about 100 ms**. Everything downstream depends only on this contract.

### 5.2 Implementation A: Electron loopback (default)

1. Main registers a display-media handler that answers with a screen source and audio set to `loopback`.
2. The Capture Host window calls `getDisplayMedia`, then stops and discards the video track. Audio constraints must set `echoCancellation`, `noiseSuppression` and `autoGainControl` to `false`: Chrome enables all three by default, even on loopback.
3. An `AudioContext` created at 16 kHz connects the stream to an `AudioWorklet`. The worklet downmixes to mono, converts float samples to 16-bit integers, and posts frames over a `MessagePort`.
4. Main hands the other end of that port directly to the Audio Worker, so audio never passes through the main thread.

> ⚠️ Verify exact API names, options and platform notes in the Electron docs for the version you pin. This is the **first thing the spike tests**.
>
> Spike result (Electron 44.7.0): `session.setDisplayMediaRequestHandler` answering `{ video: <screen source>, audio: 'loopback' }` works from a hidden window (`show: false`, `backgroundThrottling: false`) when main starts capture via `executeJavaScript(code, true)`, which provides the user gesture. The track arrives as 48 kHz stereo; an `AudioContext({ sampleRate: 16000 })` resamples it. Setup takes about 3 s. See `spikes/loopback-capture/`.

### 5.3 Implementation B: native process-loopback helper (fallback)

A small standalone executable (Rust, C# or C++) using the Windows process-loopback capture API.

- Accepts a process id and an include/exclude flag
- Resamples to the contract format
- Writes frames to stdout or a named pipe
- Spawned and supervised by the Audio Worker

This option gives **per-application isolation**, which removes notification sounds and other-tab audio from the capture. It requires a recent Windows build.

### 5.4 Target selection

- Default: whole-system capture.
- If implementation B is present, the overlay and settings offer a choice of running audio applications.
- A browser is one process tree, so isolating a single tab is not possible. The UI says so.

---

## 6. Audio pipeline (Audio Worker)

```
frames -> ring buffer -> VAD -> speech/silence labeling -> chunker -> WAV encoder
              |                                                          |
              +-------------------> spool file (temp) <------------------+
```

| Stage | Responsibility |
|---|---|
| **Ring buffer** | Absorbs timing jitter. Bounded size. Back-pressure drops are logged, never silent. |
| **VAD** | Voice-activity detection: a small ONNX model, or an energy-based detector to start. Produces speech and silence spans. |
| **Spool file** | All frames are appended to a temp file, so a crash loses at most a few seconds. |
| **Chunker** | Targets ~30 s windows, prefers cutting at silence, adds 1–2 s overlap. |
| **Encoder** | Encodes chunks to WAV or a compressed format the provider accepts. |
| **Metrics** | Level, speech ratio, clipping, music-likelihood heuristic. Fed to quality warnings. |

Silence is trimmed before upload. The **speech ratio** decides the note mode (Full or Quick) and triggers quality warnings, for example when little speech is detected.

---

## 7. Speech-to-text subsystem

```ts
export interface SpeechToTextProvider {
  readonly id: string;
  readonly capabilities: {
    streaming: boolean;
    maxChunkSec: number;
    languages: 'auto' | string[];
    wordTimestamps: boolean;
  };
  transcribeChunk(
    chunk: AudioChunk,
    opts: { language?: string; prompt?: string }
  ): Promise<ChunkResult>;
  openStream?(opts: StreamOptions): StreamingSession; // optional, Phase 6
}

export type ChunkResult = {
  segments: { startMs: number; endMs: number; text: string; confidence?: number }[];
  language?: string;
  costEstimateUsd?: number;
};
```

### Transcript assembler

- Offsets each chunk's segment timestamps by the chunk start time.
- Removes duplicated text in the overlap region by aligning the tail of one chunk with the head of the next.
- Passes the last sentence of the previous chunk as a prompt hint to the next, which improves continuity and keeps technical terms consistent.
- Produces one ordered list of segments: the **canonical transcript**.

### Providers

- `CloudProviderA`, `CloudProviderB` behind the interface, for the provider comparison
- `LocalWhisperProvider` later
- A **provider registry** selects the active one from settings

### Resilience

Timeouts, exponential backoff with jitter, per-chunk retry, and a **persistent job** so a transcription pass resumes after an app restart.

---

## 8. Capture session state machine

Implemented in `packages/core` as a **pure reducer**, driven by the main-process orchestrator.

```
IDLE --start--> STARTING --started--> LISTENING <--pause/resume--> PAUSED
                 |    |                    |                         |
       startFailed    cancel               +--- stop / captureLost --+
                 v    v                    v
            FAILED  DISCARDED          STOPPING   (flush worker, finalize spool)
                                           |
                                        stopped
                                           v
                                     TRANSCRIBING (chunk jobs, retries)   <-- transcribeFailed / retry
                                           |
                                       transcribed
                                           v
                                     GENERATING   (LLM note)             <-- generateFailed / retry
                                           |
                                       generated
                                           v
                                        REVIEW --save--> SAVED

discard: LISTENING, PAUSED, TRANSCRIBING, GENERATING, REVIEW --> DISCARDED
```

- The reducer state is `{ state, error }`. Failure events (`startFailed`, `captureLost`, `transcribeFailed`, `generateFailed`) set `error`; every other transition clears it.
- **Retryable failures stay in place:** a failed transcription or generation keeps its state with `error` set, and must be `retry`-ed before it can complete. **Capture loss is a stop:** `captureLost` goes to `STOPPING` so the audio so far is kept and transcribed. See [ADR 0003](./adr/0003-session-failure-transitions.md).
- `IDLE` is never persisted; a session row starts in `STARTING`. Terminal states: `SAVED`, `DISCARDED`, `FAILED`.
- Every transition is **persisted** to the `sessions` table.
- On launch, the orchestrator scans for sessions not in a terminal state and offers recovery: **resume transcription**, **retry generation**, or **discard**.
- Failures in `TRANSCRIBING` or `GENERATING` keep the session in a retryable state and **never delete the transcript or spool file until the note is saved**.

---

## 9. AI pipeline

```ts
export interface LLMProvider {
  generateStructured<T>(req: {
    system: string;
    user: string;
    schema: ZodSchema<T>;
    maxTokens: number;
  }): Promise<{ data: T; usage: Usage }>;
}
```

### Flow

1. **Decide mode** from speech duration: Quick Save or Full Note.
2. **Short transcript:** a single call with a versioned prompt.
3. **Long transcript:** split into sections of ~3,000–6,000 tokens at pause boundaries, summarize each section with timestamps, then combine them into the note in a final call (map-reduce).
4. **Validate** the response against a zod schema. On failure, make one repair call that includes the validation error, then fail visibly.
5. **Ground check (cheap):** every key point must carry a segment time range, and a heuristic checks that quoted terms appear in the transcript. Points that fail are flagged in the review screen.

### Prompt rules

- Use only information in the transcript
- Preserve technical terms exactly
- Mark unclear terms as uncertain
- Never add outside facts
- Output in the transcript's language unless the user asks otherwise

Prompts live in `packages/core/prompts` with a version string. The **prompt version and model are stored on each note**.

### Output schemas

| Mode | Fields |
|---|---|
| **Full Note** | `title`, `summary`, `keyPoints` (with supporting time ranges), `tags`, `language`, `uncertainTerms` |
| **Quick Save** | `title`, `gist`, `tags`, `language` |

---

## 10. Data architecture

SQLite through Node's built-in `node:sqlite` in the main process ([ADR 0002](./adr/0002-node-sqlite.md)):

- WAL mode, `synchronous = FULL`, foreign keys on
- Forward-only SQL migrations applied at startup, tracked in `PRAGMA user_version`
- No native module to rebuild: tests and the app run the same code

### Schema

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  duration_ms INTEGER,
  source_app TEXT,
  source_title TEXT,
  capture_source TEXT,
  spool_path TEXT,
  speech_ratio REAL,
  error TEXT
);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  mode TEXT NOT NULL,            -- 'full' | 'quick'
  title TEXT,
  summary TEXT,
  key_points TEXT,               -- JSON
  transcript TEXT NOT NULL,
  language TEXT,
  ai_model TEXT,
  prompt_version TEXT,
  stt_provider TEXT,
  favorite INTEGER DEFAULT 0,
  last_opened_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);

CREATE TABLE segments (
  id INTEGER PRIMARY KEY,
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  start_ms INTEGER,
  end_ms INTEGER,
  text TEXT NOT NULL,
  confidence REAL
);

CREATE TABLE tags (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL
);

CREATE TABLE note_tags (
  note_id TEXT,
  tag_id INTEGER,
  PRIMARY KEY (note_id, tag_id)
);

CREATE VIRTUAL TABLE notes_fts USING fts5(
  note_id UNINDEXED, title, summary, key_points, tags, transcript,
  tokenize = 'porter unicode61'
);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,            -- 'transcribe_chunk' | 'generate_note'
  session_id TEXT NOT NULL,
  payload TEXT,
  status TEXT NOT NULL,
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  next_run_at INTEGER
);

CREATE TABLE usage_log (
  id INTEGER PRIMARY KEY,
  session_id TEXT,
  provider TEXT,
  kind TEXT,
  units REAL,
  cost_estimate_usd REAL,
  at INTEGER
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL            -- JSON, validated against SettingsSchema on read
);

CREATE TABLE secrets (
  id TEXT PRIMARY KEY,           -- 'deepgram' | 'groq' | 'gemini'
  ciphertext BLOB NOT NULL,      -- safeStorage-encrypted; plaintext is never stored
  updated_at INTEGER NOT NULL
);
```

- The FTS table is updated by the repository **inside the same transaction** as the note write.
- A later migration adds an embeddings table through `sqlite-vec` for semantic search.

**Repository layer:** `NotesRepo`, `SessionsRepo`, `JobsRepo`, `SettingsRepo`, `UsageRepo`, plus `SecretStore` for API keys. Renderers never see SQL.

---

## 11. IPC contract

All channels are defined once in `packages/core` as zod schemas. The preload script exposes one narrow function per channel through `contextBridge`. The main process validates every incoming payload and rejects anything unexpected.

| Direction | Channel | Purpose |
|---|---|---|
| UI → main | `capture:start`, `capture:stop`, `capture:pause` | Intents |
| UI → main | `notes:list`, `notes:get`, `notes:search`, `notes:save`, `notes:update`, `notes:delete` | CRUD |
| UI → main | `settings:get`, `settings:set`, `secrets:set` | Settings. Keys can be written but never read back |
| UI → main | `sessions:recover` | Resume or discard a stored session |
| Main → UI | `session:state` | State machine updates |
| Main → UI | `capture:level` | Audio level for the meter (throttled) |
| Main → UI | `transcript:partial` | Live text (Phase 6) |
| Main → UI | `note:ready` | Generated note for review |
| Main → UI | `error:user` | Plain-language errors with an action |

> The audio data path (Capture Host → Audio Worker) is a direct `MessagePort` and is **not** part of the general IPC surface.

---

## 12. Renderer architecture

### Main UI

- React, Vite, TypeScript, Zustand, a small router, Tailwind, Lucide icons
- **Screens:** Home, Capture, Review, Library, Note detail, Settings, Recovery
- State mirrors main-process events plus local view state. **No business logic.**

### Overlay UI

- A very small React bundle
- Five states: `idle`, `listening`, `processing`, `done`, `error`
- A timer and a pause control
- Loads quickly and uses almost no memory

### Capture Host

- A bare page with no UI framework: only capture and worklet code

---

## 13. Floating overlay and system integration

| Feature | Details |
|---|---|
| **Window** | Frameless, transparent, always on top at a high level, skips the taskbar, not resizable, shown without stealing focus |
| **Position** | Draggable, remembered per display, snaps to screen edges, restored if a monitor disappears |
| **Hotkey** | Global shortcut registered in main, with conflict detection and a fallback prompt |
| **Tray** | Start, stop, open library, settings, quit |
| **Recording indicator** | Overlay border or dot plus a tray icon state, always visible during capture |
| **Source detection** | At capture start, read the foreground window title and process name (best effort). Stored as `source_app` and `source_title` |

> ⚠️ **Fullscreen caveat:** always-on-top overlays may not appear over some exclusive-fullscreen apps. The hotkey and tray are the reliable path.

---

## 14. Security architecture

- `contextIsolation` on, `sandbox` on, `nodeIntegration` off in **every** window
- Strict Content Security Policy. No remote content loaded into any window.
- Navigation and new-window requests denied by default. External links open in the default browser.
- The permission request handler allows **only** the display-media request for the Capture Host and denies everything else.
- All IPC payloads validated with zod. Channel allow-list in preload.
- API keys are written to Electron `safeStorage` (encrypted with OS facilities) and decrypted only in main when making provider calls. **The renderer can write a key but never read it back.**
- Logs redact keys and exclude transcript text unless the user enables verbose diagnostics.
- Dependencies pinned, audit run in CI, Electron kept current.

> A packaged app cannot truly hide a key, so this model is for **personal use only**. Distribution requires the proxy in [§20](#20-optional-backend-only-before-public-distribution).

---

## 15. Error handling matrix

| Failure | Detection | Behavior |
|---|---|---|
| Capture permission or source unavailable | `start()` rejects | Return to IDLE, plain message, offer retry |
| Audio device changes mid-capture | `ended` or `error` event | Attempt one restart, otherwise stop and keep audio so far |
| Audio worker crash | Process exit event | Respawn, resume from spool file, mark gap in transcript |
| Little or no speech detected | Speech ratio | Warn before spending STT money; let user continue or discard |
| STT network or quota error | HTTP error | Retry with backoff, then keep job pending and notify |
| LLM invalid output | Schema failure | One repair call, then show transcript with a retry button |
| App crash during capture | Non-terminal session at launch | Recovery screen with spool audio |
| Disk full | Write error | Stop capture cleanly, preserve what exists, notify |
| Spend cap reached | Usage check | Stop new provider calls, explain, offer to raise the cap |

---

## 16. Observability

- `electron-log` with rotating files
- Structured log events with session ids
- **Diagnostics export button:** bundles recent logs, app version, Windows version and provider status, with transcript text excluded
- Local usage screen that reads `usage_log`
- No remote telemetry in the MVP

---

## 17. Performance and resource budgets

These are starting targets. Measure on your own machine and adjust.

| Item | Target |
|---|---|
| Idle memory (overlay only) | Well under 200 MB total across processes |
| CPU while capturing | Low single-digit percent on a typical laptop |
| Capture latency (audio → worker) | Under 300 ms |
| Stop → first transcript text (10 min session) | Under ~1.5× provider processing time |
| Stop → saved note (10 min session) | Under ~60 s typical |
| Search | Instant for thousands of notes with FTS5 |

---

## 18. Testing strategy

| Layer | Approach |
|---|---|
| **Unit (Vitest)** | State machine, chunk math, overlap de-duplication, schema validation, prompt builders |
| **Pipeline** | `FakeAudioSource` replays fixture WAV files through the real worker, VAD and chunker, with `FakeSTT` and `FakeLLM`. Runs in CI without audio hardware. |
| **Repository** | In-memory SQLite; migrations applied from scratch and from older versions |
| **Contract** | IPC payload schemas; provider adapters against recorded responses |
| **End-to-end** | Playwright for Electron: launch → fake capture → save note → search |
| **Evaluation** | `packages/eval` runs the 20-clip set through real providers and writes rubric score tables. Run on any change to STT provider, model or prompt version. |
| **Manual matrix** | The spike's source list (browser, VLC, course players…), repeated before each release |

---

## 19. Build, packaging and release

- `electron-vite` for development and builds
- `electron-builder` producing an NSIS installer
- **CI (GitHub Actions):** lint, type-check, unit tests, native module rebuild, packaged smoke test
- Code signing and auto-update: decide when the app leaves your own machine
- Native helper (if used) built per release and bundled as an extra resource

---

## 20. Optional backend (only before public distribution)

```
App --(user token)--> Nova API proxy --(provider keys)--> STT / LLM providers
                       auth, quotas, usage metering, key custody
```

A small Node.js + TypeScript service that holds provider keys, authenticates users, enforces quotas and logs usage. The desktop app swaps its direct provider clients for proxy clients **behind the same interfaces**, so nothing else changes.

---

## 21. Android architecture (later, gated)

| Concern | Desktop | Android |
|---|---|---|
| Language and UI | TypeScript, React | Kotlin, Jetpack Compose, MVVM |
| Capture | Electron loopback or native helper | Media projection with playback capture in a foreground service |
| Floating control | Always-on-top window | Overlay window with overlay permission |
| Audio pipeline | Utility process | Coroutines in the service |
| Storage | SQLite with FTS5 | Room with FTS |
| Settings and secrets | Store with safeStorage | DataStore with Keystore |
| STT and LLM | Provider interfaces | Same provider shapes, Kotlin clients |

**Shared artifacts:** the `contracts/` folder (Note JSON Schema), prompt files, and the evaluation set. Code is not shared. Android work begins only after an Android spike passes.

---

## 22. Extension points

- **LocalWhisperProvider:** implements `SpeechToTextProvider`, runs in its own utility process
- **Semantic search:** embeddings job after note save, `sqlite-vec` table, hybrid ranking with FTS
- **Source URL capture:** a small browser extension sending the active tab URL to the app over a local channel
- **Cloud sync:** replace repositories with a sync-aware layer; add accounts through the proxy
- **Other note styles:** additional prompt modes such as meeting minutes, flashcards or action items

---

## 23. Key architecture decisions

| Decision | Chosen | Alternatives considered | Reason |
|---|---|---|---|
| Desktop framework | Electron | Tauri, native C# | Fits TypeScript skills, built-in loopback capture, large ecosystem |
| System audio | Electron loopback, native helper as fallback | WASAPI native first | Least work to validate; upgrade only if needed |
| Capture location | Hidden Capture Host window | Capture in main UI | Survives UI reloads, cleaner isolation |
| Audio processing | Utility process | Main process, renderer | Keeps UI and main responsive; restartable |
| Transcription flow | Batch first, live later | Streaming first | Simpler, more reliable, same final quality |
| Database | SQLite with FTS5 | IndexedDB, Postgres | Local, fast, zero setup |
| Vector search | sqlite-vec in same file | Chroma, Qdrant, pgvector | One file, no extra services |
| Secrets | safeStorage | Plain env vars | Encrypted at rest, simple |
| Backend | None for MVP | Express from day one | Avoids unneeded complexity for personal use |
| Domain code | Pure TS package | Logic inside Electron | Testable and reusable |

> 💡 Turn each row into a short ADR in `docs/adr/` (context → decision → consequences). Interviewers love these.

---

## 24. v1 scope: build now vs. defer

The goal for v1 is **depth over breadth**: a few hard problems solved well, in an app you actually use.

### ✅ Build in v1 (highest resume signal)

| Feature | Why it matters |
|---|---|
| Crash-safe capture: state machine, spool file, recovery screen | "Kill the app mid-recording, relaunch, nothing lost." Great demo and interview story |
| STT and LLM provider interfaces with two STT providers | Shows design for replaceability; gives real comparison numbers |
| Persistent job queue with retries and backoff | Graceful network failure handling, which most portfolio projects skip |
| Pipeline tests with `FakeAudioSource`, `FakeSTT`, `FakeLLM` | Full pipeline in CI without hardware stands out |
| SQLite + FTS5 search | Cheap to build, looks great in a demo, genuinely useful |
| Strict Electron security setup (§14) | Shows awareness of desktop app security |
| Tray + global hotkey | Makes it usable day to day |

### ⏸️ Defer (list as "future work" in the README)

- Native process-loopback helper (only if Electron loopback fails)
- Floating overlay window (tray + hotkey first)
- Live streaming transcription
- Map-reduce for very long transcripts (start with a single call; add when you hit limits)
- Full 20-clip eval harness (start with 3–5 clips)
- `sqlite-vec` semantic search
- Proxy backend
- Android app
- Code signing and auto-update

---

## 25. Build roadmap

### Phase 0: Spike (1–2 weekends)

**Goal:** prove the riskiest part works, and start using it.

- [ ] Minimal Electron app with a hidden Capture Host window
- [ ] `getDisplayMedia` with loopback audio → record 60 s to a WAV file
- [ ] Test sources: Chrome/Edge video, VLC, a course platform
- [ ] Script: WAV → STT provider → transcript text
- [ ] Script: transcript → LLM → markdown note in a folder
- [ ] Compare 2 STT providers on 3–5 real clips (accuracy, speed, cost)

**Exit criteria:** you can capture a lecture and get a usable note. If loopback fails, decide on the native helper.

### Phase 1: Core foundation

- [x] Monorepo: `apps/desktop`, `packages/core`
- [x] `packages/core`: types, zod schemas, state machine reducer + unit tests
- [x] Main process skeleton: window manager, IPC router with validation, preload bridge
- [x] SQLite with migrations, repositories, settings, safeStorage for API keys
- [x] Fake providers (`FakeSTT`, `FakeLLM`)

### Phase 2: Audio pipeline and transcription

- [ ] Audio Worker as a utility process; MessagePort from Capture Host
- [ ] Ring buffer → energy-based VAD → chunker (~30 s, silence cuts, overlap) → WAV encoder
- [ ] Spool file
- [ ] `FakeAudioSource` + pipeline tests with fixture WAVs
- [ ] STT provider adapter, transcript assembler (offsets, overlap de-dup, prompt hint)
- [ ] Persistent job queue with retries and backoff

### Phase 3: AI notes and review

- [ ] `LLMProvider` adapter with `generateStructured` and zod validation + one repair call
- [ ] Versioned prompts for Quick Save and Full Note
- [ ] Ground check: time ranges on key points, quoted-term check
- [ ] Review screen: edit, save, discard

### Phase 4: Library and search

- [ ] Library screen with list, favorites, tags
- [ ] FTS5 search, updated transactionally with note writes
- [ ] Note detail with clickable timestamps
- [ ] Export to Markdown

### Phase 5: System integration

- [ ] Tray menu and global hotkey
- [ ] Recording indicator
- [ ] Source app/title detection (best effort)
- [ ] (Optional) floating overlay

### Phase 6: Hardening and polish

- [ ] Recovery screen for non-terminal sessions
- [ ] Error matrix behaviors (§15), spend cap, low-speech warning
- [ ] electron-log + diagnostics export
- [ ] Measure performance budgets (§17)
- [ ] Playwright E2E: launch → fake capture → save → search
- [ ] electron-builder NSIS installer + GitHub Actions CI

---

## 26. Resume and showcase checklist

- [ ] **README** with a one-line pitch, demo GIF, architecture diagram, "why" behind key decisions, and a future-work section
- [ ] **Demo video (60–90 s):** start capture over a YouTube lecture → stop → note appears → search finds it → (bonus) kill app mid-capture and recover
- [ ] **ADRs** in `docs/adr/` for the main decisions (§23)
- [ ] **Measured numbers:** idle memory, stop-to-note time, test count/coverage, STT provider comparison
- [ ] **CI badge** showing green tests
- [ ] **Clean commit history** showing incremental progress
- [ ] **Interview prep:** be able to explain *why* for every major choice (utility process, hidden window, batch before streaming, pure core package, FTS in the same transaction)

### Sample resume bullet

> **Nova Capture**: Windows desktop app (Electron, TypeScript, React, SQLite) that captures system audio and turns it into searchable AI-generated notes. Designed a crash-safe capture pipeline (persisted state machine, spool files, retrying job queue) with zero data loss on crash; pluggable STT/LLM provider interfaces; full pipeline test suite running in CI on fixture audio; FTS5 full-text search across notes.

*(Update the bullet with your real numbers once you've measured them.)*
