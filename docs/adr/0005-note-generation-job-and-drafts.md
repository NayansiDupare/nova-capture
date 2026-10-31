# 0005. Generate notes as a persistent job and keep drafts until save

- Status: Accepted
- Date: 2026-10-13

## Context

Phase 3 turns a finished transcript into a note (ARCHITECTURE §9) that the user reviews before saving. The open questions were:

1. Where the LLM call runs, and what survives a crash or restart during `GENERATING` or `REVIEW`.
2. Where a generated note lives before the user saves it.
3. What "one repair call, then fail visibly" (§9, §15) means for retries, since every call costs money.
4. How to request structured output from Gemini without keeping two hand-written schemas in sync.

## Decision

- **Generation is a `generate_note` job** in the existing persistent queue, with the stable id `<session>:generate`. After `transcribed`, the orchestrator enqueues it (`ON CONFLICT DO NOTHING`, as with chunk jobs). The job assembles the transcript, calls the LLM through `generateNote` in `packages/core`, and stores the result.
- **Drafts live in `note_drafts`** (migration 003), one row per session. A finished job moves the session to `REVIEW`. The job does nothing if a draft already exists, so a crash between saving the draft and recording the transition never pays for a second note. On launch, a `GENERATING` session without an error re-enqueues its job (a no-op if it exists) and moves on if the draft is already there.
- **Save is one transaction.** It inserts the note, segments, tags and FTS row, deletes the draft and makes the `REVIEW → SAVED` transition together. `inTransaction` now joins an outer transaction instead of failing, so repositories can be combined. The renderer sends only the editable fields (title, summary, key points, tags). Mode, language, model and prompt version come from the draft, and key points are ground-checked again on save.
- **One repair call, then a permanent failure.** If the output does not match the zod schema, the second request repeats the prompt plus the validation problems. If that fails too, the job throws `PermanentJobError`: the runner does not retry it automatically, and the session stays in `GENERATING` with a plain error and a Retry button. Provider errors still follow the normal rule (429, 5xx and network errors retry with backoff; 400 and 401 do not). Usage is logged for every billed call, including invalid answers.
- **No speech means no LLM call.** An empty transcript fails the job permanently with a plain message instead of paying for a note about nothing.
- **One schema source.** The zod output schemas in `packages/core` are converted with `z.toJSONSchema` and mapped to Gemini's `responseSchema` subset (upper-case types, properties, required, items: the shape verified in the spike). Length limits are dropped there and enforced by zod afterwards.
- **Ground check is a cheap heuristic.** A key point is flagged when no transcript segment overlaps its time range (±1 s), or when it quotes a term (double quotes, curly quotes or backticks) that the transcript never contains as whole words. Flags are hints in the Review screen, not rejections.

## Consequences

- Recovery stays deterministic and never pays twice: the draft is the proof that generation succeeded.
- A note that fails after repair costs at most two calls. Retrying is the user's choice.
- `note_drafts` is a second place where note content lives before save. Phase 4 lists and searches only `notes`, so drafts never appear in the Library.
- Map-reduce for very long transcripts is still deferred (§24). Gemini Flash's context window fits hours of transcript in one call; the 8,192-token output limit covers the note plus thinking tokens.
- The `note:ready` event is not used yet: the UI loads the draft with `notes:draft` when it sees `session:state` REVIEW, which also works after a reload. The overlay (Phase 5) can add the event.
