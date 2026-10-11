# Nova Capture — Testing Strategy

> Version 1.0 · 11 October 2026
> Tools: **Vitest** (unit, pipeline, repository, contract) · **Playwright for Electron** (E2E) · custom eval harness (`packages/eval`)

---

## 1. Principles

1. **Test the pipeline without hardware.** Every stage runs on fixture audio in CI.
2. **Fakes over mocks.** Use real implementations with fake edges (`FakeAudioSource`, `FakeSTT`, `FakeLLM`, in-memory SQLite).
3. **No paid API calls in CI.** Providers are tested against recorded responses.
4. **Reliability paths are tested, not hoped for.** Crashes, retries and recovery have explicit tests.
5. **Fast feedback.** The default `pnpm test` should finish in well under a minute.

---

## 2. Test pyramid

```
                 ▲   Manual matrix (before each release)
                ▲▲▲  Eval harness (on provider/model/prompt changes)
              ▲▲▲▲▲  E2E — Playwright for Electron (few, critical flows)
           ▲▲▲▲▲▲▲▲  Pipeline + repository + contract tests
      ▲▲▲▲▲▲▲▲▲▲▲▲▲▲  Unit tests (most tests live here)
```

---

## 3. Layers

### 3.1 Unit tests (Vitest)

**Where:** `packages/core`, pure helpers in `apps/desktop`.

| Area | What to test |
|---|---|
| Session state machine | Every valid transition; invalid transitions rejected; recovery from each non-terminal state |
| Chunk math | Window sizes, silence-preferring cut points, overlap ranges, edge cases (very short, all silence) |
| Overlap de-duplication | Exact overlap, partial overlap, no overlap, repeated phrases |
| Timestamp offsetting | Segments shifted correctly across chunks |
| VAD (energy-based) | Speech/silence spans on synthetic signals |
| Schemas | Valid and invalid payloads for every IPC channel and note shape |
| Prompt builders | Snapshot tests; version string present |
| Retry/backoff | Delays grow, jitter applied, max attempts respected (inject clock and random) |
| Ground check | Points with and without matching transcript evidence |

### 3.2 Pipeline tests

**Where:** `apps/desktop/src/worker/__tests__/`, `apps/desktop/src/main/__tests__/pipeline/`

`FakeAudioSource` replays fixture WAV files through the **real** worker (ring buffer → VAD → chunker → encoder → spool) and the **real** transcript assembler, with `FakeSTT` and `FakeLLM`.

| Scenario | Expected result |
|---|---|
| Normal 2-min speech clip | Chunks produced, transcript assembled, note generated |
| Mostly music / silence | Low speech ratio → warning; no STT call until confirmed |
| STT fails twice, then succeeds | Retries with backoff; final transcript complete |
| STT always fails | Job stays pending; session retryable; spool kept |
| LLM returns invalid JSON | One repair call; then visible failure with transcript preserved |
| Worker crash mid-capture | Respawn; resume from spool; gap marked |
| Device ends mid-capture | One restart attempt; otherwise stop and keep audio |

### 3.3 Repository tests

- In-memory SQLite (`:memory:`).
- Migrations applied **from scratch** and **from each previous version**.
- Note save writes note, segments, tags and FTS entry in **one transaction** (simulate a failure mid-write → nothing partial persists).
- FTS search returns expected notes, including stemming (`porter`) and Unicode.
- Soft delete hides notes from list and search.

### 3.4 Contract tests

- **IPC:** every channel's schema accepts valid examples and rejects invalid ones.
- **Providers:** adapters parse **recorded** provider responses (success, 4xx, 429, 5xx, malformed) stored in `fixtures/providers/`. Recordings must contain no real keys or personal content.
- **Contracts folder:** generated JSON Schema matches the zod schemas.

### 3.5 End-to-end (Playwright for Electron)

Run against a built app with fake providers enabled by a test-only flag.

| Flow |
|---|
| Launch → start fake capture → stop → review → save → note appears in Library |
| Search finds the saved note by a word from its transcript |
| Kill app during capture → relaunch → Recovery screen → resume → note saved |
| Settings: save API key → UI never shows it again |

Keep E2E tests few and stable. No sleeps; wait on UI states.

### 3.6 Evaluation harness (`packages/eval`)

- Runs the clip set (start with 3–5 clips, grow to 20) through **real** providers.
- Scores: transcript word error rate (vs. reference text), note rubric (accuracy, coverage, no hallucinations, terms preserved), latency, cost.
- Writes a dated results table to `packages/eval/results/`.
- **Run on any change to:** STT provider, LLM model, prompt version, chunking parameters.
- Manual trigger only (`pnpm eval`). Costs money.

### 3.7 Manual test matrix (before each release)

| Source | Check |
|---|---|
| Chrome / Edge YouTube | Capture, note quality |
| VLC local video | Capture |
| Course platform (browser) | Capture |
| Fullscreen video | Hotkey and tray still work |
| Headphones ↔ speakers switch mid-capture | Device change handling |
| Two monitors, unplug one | Overlay position restored |
| Network off during transcription | Retry and recovery |
| Sleep/wake during capture | Session state sane |

---

## 4. Fixtures

```
fixtures/
├── audio/
│   ├── speech-2min-en.wav        # clean lecture-style speech
│   ├── speech-with-music.wav     # speech over background music
│   ├── music-only-30s.wav        # should trigger low-speech warning
│   ├── silence-10s.wav
│   └── short-20s.wav             # Quick Save path
├── transcripts/                  # reference text for eval and assembler tests
└── providers/                    # recorded STT/LLM responses (sanitized)
```

- All fixture audio is **16 kHz mono 16-bit PCM WAV**, matching the AudioSource contract.
- Use only audio you created or that is clearly licensed for reuse. Never commit personal recordings.
- Keep fixtures small; large files go through Git LFS.

---

## 5. Conventions

- Test files sit next to source: `chunker.ts` → `chunker.test.ts`.
- Name tests by behavior: `it('cuts at the nearest silence within 5 seconds of the target')`.
- Arrange / Act / Assert structure; one behavior per test.
- Inject time (`now`), randomness and IDs; never depend on real clocks or `Math.random` in assertions.
- No network in unit, pipeline, repository or contract tests (enforced by a test setup that blocks `fetch`).

### Example

```ts
import { describe, it, expect } from 'vitest';
import { reduce } from './session-machine';

describe('session state machine', () => {
  it('moves from LISTENING to STOPPING on stop', () => {
    const next = reduce({ state: 'LISTENING' }, { type: 'stop' });
    expect(next.state).toBe('STOPPING');
  });

  it('rejects stop while IDLE', () => {
    expect(() => reduce({ state: 'IDLE' }, { type: 'stop' })).toThrow(/invalid transition/i);
  });
});
```

---

## 6. Coverage targets

| Package | Target (lines) |
|---|---|
| `packages/core` | ≥ 90% |
| `apps/desktop/src/worker` | ≥ 80% |
| `apps/desktop/src/main` (repos, orchestrator, providers) | ≥ 75% |
| Renderers | Critical components and stores; no hard target |

Coverage is a guide, not a goal. A missing test for a failure path matters more than a percentage.

---

## 7. CI pipeline (GitHub Actions)

```
install (frozen lockfile)
  → typecheck
  → lint
  → unit + pipeline + repository + contract tests (with coverage)
  → rebuild native modules for Electron
  → build app
  → E2E (Playwright, fake providers)
  → packaged smoke test (installer launches, window opens)
  → pnpm audit
```

A PR merges only if every step is green.

---

## 8. Definition of done (testing)

- [ ] New logic has unit tests, including at least one failure case
- [ ] Changes to the pipeline have a pipeline test
- [ ] Schema or migration changes have repository/contract tests
- [ ] Prompt changes bump the version and update snapshots
- [ ] No test makes a real network call
- [ ] `pnpm test` passes locally and in CI
