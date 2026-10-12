# 0003. Session failure and cancel transitions

- Status: Accepted
- Date: 2026-10-12

## Context

The state diagram in ARCHITECTURE §8 left several cases open:

1. How a failed transcription or note generation is represented ("keep the session in a retryable state").
2. What happens when capture ends unexpectedly (device lost, disk full). §15 says to keep the audio so far.
3. Stopping while paused, discarding after start-up, and cancelling during the ~3 s start-up.

State names are persisted in `sessions.state`, so they are hard to change later.

## Decision

- **Retryable failures stay in place.** `transcribeFailed` / `generateFailed` keep the session in `TRANSCRIBING` / `GENERATING` and set `error`. `retry` clears it. A session with an error must be retried before `transcribed` / `generated` is accepted.
- **Capture loss is a stop.** `captureLost` moves `LISTENING` or `PAUSED` to `STOPPING` with `error` set, so the spool is finalized and transcribed like a normal stop.
- **Extra transitions:** `PAUSED --stop--> STOPPING`; `discard` from `LISTENING`, `PAUSED`, `TRANSCRIBING`, `GENERATING`, `REVIEW`; `STARTING --cancel--> DISCARDED`.
- The snapshot is `{ state, error }`. Failure events set `error`; every other transition clears it.
- `IDLE` is never persisted. A row is created by applying `start`, so it begins in `STARTING`.

## Consequences

- No extra states to persist or recover. Recovery at launch only needs the existing events: `captureLost` + `stopped` for a session interrupted mid-capture, `retry` for a failed job.
- `STOPPING` cannot be discarded: the worker is still flushing the spool. Discard once it reaches `TRANSCRIBING`.
- A failure while stopping (for example disk full while finalizing the spool) is not modelled yet. Add it with the Audio Worker in Phase 2.
