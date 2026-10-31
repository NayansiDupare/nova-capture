-- Phase 3: generated notes wait in note_drafts until the user saves or discards them.
-- Saved notes live in notes (plus segments, tags and notes_fts), written in one transaction.
-- Forward-only: never edit this file after merge (AGENTS.md §4.7).

CREATE TABLE note_drafts (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id),
  content TEXT NOT NULL,         -- JSON NoteContent (packages/core/src/notes/note.ts)
  ai_model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

ALTER TABLE notes ADD COLUMN uncertain_terms TEXT;  -- JSON string[]

-- One note per session: saving twice cannot create a duplicate.
CREATE UNIQUE INDEX notes_session ON notes (session_id);
CREATE INDEX segments_note ON segments (note_id);
