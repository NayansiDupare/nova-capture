-- Phase 2: one row per transcribed chunk, written as each STT job finishes, so a crash or
-- restart never repeats (or re-pays for) finished chunks. The canonical transcript is
-- assembled from these rows (ARCHITECTURE.md §7).
-- Forward-only: never edit this file after merge (AGENTS.md §4.7).

CREATE TABLE transcript_chunks (
  session_id TEXT NOT NULL REFERENCES sessions(id),
  chunk_index INTEGER NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  provider TEXT NOT NULL,
  segments TEXT NOT NULL,        -- JSON [{startMs, endMs, text, confidence?}], relative to start_ms
  language TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, chunk_index)
);

CREATE INDEX jobs_due ON jobs (status, next_run_at);
CREATE INDEX jobs_session ON jobs (session_id);
