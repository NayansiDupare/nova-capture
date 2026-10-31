# 0006. User vocabulary as an STT hint and a note-only correction

- Status: Accepted
- Date: 2026-10-14

## Context

The first real capture transcribed "RAG" (retrieval-augmented generation) as "RAC". The note prompt tells the LLM to keep terms exactly as transcribed, so the note repeated the mistake. ADR 0004 dropped the "previous sentence" prompt hint because chunks run in parallel, and noted that a glossary-style prompt could come back if technical terms suffered.

Options considered: a user vocabulary (free), a more accurate Whisper model (`whisper-large-v3`, about 2.8× the cost), or letting the LLM fix terms from context on its own (free, but it can "correct" terms that were right).

## Decision

- A **`vocabulary` setting** (up to 100 terms, 60 characters each, default empty) holds the spellings the user expects, such as `RAG, LangChain`. The developer panel edits it until the Settings screen exists.
- **STT:** every chunk sends `Glossary: RAG, LangChain.` as Whisper's `prompt` (Groq supports it; the limit is 224 tokens, so the hint is capped at 400 characters and drops whole terms). It does not depend on other chunks, so parallel transcription is unaffected.
- **Note:** prompt `note-v2` adds the vocabulary to the user message. When a transcript word sounds like a vocabulary term and the context fits, the note uses the vocabulary spelling. Full notes list the correction as `RAC → RAG` in `uncertainTerms`, which the Review screen shows under "Possibly misheard". The LLM must not add vocabulary terms the audio does not mention.
- **Transcript stays as heard.** Stored transcript chunks are never rewritten; only the note uses corrected spellings. The ground check treats quoted vocabulary terms as supported, so a corrected "RAG" is not flagged just because the transcript says "RAC".
- The vocabulary is read for each chunk and note, so a change applies from the next attempt, including a Retry.

## Consequences

- No extra cost: the hint adds a few tokens per call.
- Saved notes can differ from their transcript on vocabulary terms. Search indexes both, so searching either spelling finds the note.
- A wrong vocabulary entry can mislead both STT and the LLM. The correction list in `uncertainTerms` keeps this visible.
- Run `pnpm eval` once it exists, to compare `note-v1` and `note-v2` on real clips.
