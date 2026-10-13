# 0004. Plan chunks from the spool after stop, transcribe them in parallel

- Status: Accepted
- Date: 2026-10-12

## Context

ARCHITECTURE §6 had the Audio Worker detect speech and cut ~30 s chunks *while* recording, so transcription could start before the user stops. That means chunk boundaries and encoder state live in worker memory during capture. After a crash they would have to be rebuilt, or persisted as well, before recovery could resume.

Transcription also has a speed budget: a 10-minute session should become a note in about 60 s (§17). In the Phase 0 spike Groq took about 0.3 s per second of audio, so 20 chunks sent one after another would take minutes.

## Decision

- **During capture** the worker only appends frames to the spool file (flushed and fsynced every second) and reports levels.
- **After stop** (or during recovery) the worker reads the finished spool in a stream, computes 100 ms frame levels, and finds speech with the energy VAD. Main then plans chunks (`planChunks` in `packages/core`): about 30 s each, cut at the nearest silence within 5 s of the target, with a 1.5 s overlap only when a cut has to fall inside speech. Silence before, after and between chunks is skipped, because providers bill for it.
- Each chunk becomes a `transcribe_chunk` job with a stable id (`<session>:transcribe:<index>`). Up to 3 run in parallel. Each result is saved in `transcript_chunks` as soon as it arrives (migration 002).
- Frames go from the Capture Host page to the worker as **copies**. Electron's `MessagePortMain` (the worker's end) only accepts transferred *ports*: a transferred `ArrayBuffer` arrives as `null`. This was found by a real capture run.

## Consequences

- Recovery is deterministic. The same spool always produces the same plan, and stable job ids plus `INSERT … ON CONFLICT DO NOTHING` make re-planning after a crash safe. Finished chunks are never transcribed, or paid for, twice.
- The prompt hint from §7 (the previous chunk's last sentence) is not used, because parallel chunks have no previous result yet. Overlap removal in the assembler handles continuity. A glossary-style prompt can come back later if technical terms suffer.
- No transcript text exists until the user stops. Live text remains a Phase 6 (streaming) feature.
- Analysis reads the whole spool once after stop (about 115 MB for an hour). It streams, so memory stays flat.
- Copying frames costs about 3.2 KB per 100 ms, which is negligible.
