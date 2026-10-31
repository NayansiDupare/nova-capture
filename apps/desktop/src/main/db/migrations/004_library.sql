-- Phase 4: the Library lists notes newest first. created_at sits after the transcript in each
-- row, so without an index a listing reads every transcript: about 1 s with 5,000 one-hour
-- notes, against about 10 ms with one.
-- Forward-only: never edit this file after merge (AGENTS.md §4.7).

CREATE INDEX notes_newest ON notes (created_at DESC, id DESC);
CREATE INDEX notes_favorites ON notes (created_at DESC, id DESC) WHERE favorite = 1;
