-- ARCHITECTURE.md §10, plus settings and secrets for SettingsRepo and SecretStore.
-- Forward-only: never edit this file after merge (AGENTS.md §4.7). Add 002_*.sql instead.

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
  mode TEXT NOT NULL,
  title TEXT,
  summary TEXT,
  key_points TEXT,
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
  type TEXT NOT NULL,
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

-- One row per setting; value is JSON, validated against SettingsSchema on read.
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- API keys encrypted with safeStorage (SECURITY.md §5). Plaintext is never stored.
CREATE TABLE secrets (
  id TEXT PRIMARY KEY,
  ciphertext BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);
