import { DatabaseSync } from 'node:sqlite';

import { describe, expect, it } from 'vitest';

import { DatabaseTooNewError, migrate, schemaVersion } from './migrate';
import { MIGRATIONS } from './migration-list';
import type { Migration } from './migration-list';
import { openDatabase } from './open-database';

const tableNames = (db: DatabaseSync) =>
  db
    .prepare("SELECT name FROM sqlite_master WHERE type IN ('table') AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((row) => row['name'])
    .filter((name) => typeof name === 'string' && !name.startsWith('notes_fts_'));

const NEXT: Migration = {
  version: MIGRATIONS.length + 1,
  name: 'test_next',
  sql: 'ALTER TABLE sessions ADD COLUMN test_flag INTEGER',
};

describe('migrations', () => {
  it('creates the full schema from scratch', () => {
    const db = openDatabase(':memory:');
    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
    expect(tableNames(db).sort()).toEqual(
      [
        'jobs',
        'note_tags',
        'notes',
        'notes_fts',
        'secrets',
        'segments',
        'sessions',
        'settings',
        'tags',
        'transcript_chunks',
        'usage_log',
      ].sort(),
    );
  });

  it('creates a working FTS5 table with porter stemming', () => {
    const db = openDatabase(':memory:');
    db.prepare('INSERT INTO notes_fts (note_id, title) VALUES (?, ?)').run('n1', 'Running tests');
    const hits = db.prepare("SELECT note_id FROM notes_fts WHERE notes_fts MATCH 'run'").all();
    expect(hits).toEqual([{ note_id: 'n1' }]);
  });

  it('is a no-op on an up-to-date database', () => {
    const db = openDatabase(':memory:');
    expect(migrate(db, MIGRATIONS)).toEqual([]);
  });

  it('upgrades from the previous version and keeps existing rows', () => {
    const db = openDatabase(':memory:');
    db.prepare("INSERT INTO sessions (id, state, started_at) VALUES ('s1', 'LISTENING', 1)").run();

    expect(migrate(db, [...MIGRATIONS, NEXT])).toEqual([NEXT.version]);

    expect(schemaVersion(db)).toBe(NEXT.version);
    expect(db.prepare('SELECT id, test_flag FROM sessions').all()).toEqual([
      { id: 's1', test_flag: null },
    ]);
  });

  it('upgrades a real version-1 database to the latest schema', () => {
    const db = new DatabaseSync(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    migrate(db, MIGRATIONS.slice(0, 1));
    db.prepare(
      "INSERT INTO sessions (id, state, started_at) VALUES ('s1', 'TRANSCRIBING', 1)",
    ).run();

    expect(migrate(db, MIGRATIONS)).toEqual([2]);

    db.prepare(
      `INSERT INTO transcript_chunks
         (session_id, chunk_index, start_ms, end_ms, provider, segments, created_at)
       VALUES ('s1', 0, 0, 30000, 'groq', '[]', 1)`,
    ).run();
    expect(db.prepare('SELECT count(*) AS n FROM transcript_chunks').get()).toEqual({ n: 1 });
  });

  it('rolls back a failing migration and stays at the last good version', () => {
    const db = openDatabase(':memory:');
    const broken: Migration = {
      ...NEXT,
      sql: 'ALTER TABLE sessions ADD COLUMN test_flag INTEGER; SELECT * FROM no_such_table;',
    };

    expect(() => migrate(db, [...MIGRATIONS, broken])).toThrow(/no_such_table/);

    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
    const columns = db
      .prepare('PRAGMA table_info(sessions)')
      .all()
      .map((c) => c['name']);
    expect(columns).not.toContain('test_flag');
  });

  it('refuses a database created by a newer app version', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(`PRAGMA user_version = ${String(MIGRATIONS.length + 1)}`);
    expect(() => migrate(db, MIGRATIONS)).toThrow(DatabaseTooNewError);
  });

  it('rejects migration lists with gaps', () => {
    const db = new DatabaseSync(':memory:');
    expect(() => migrate(db, [{ ...NEXT, version: 2 }])).toThrow(/expected 1/);
  });

  it('enables foreign keys and WAL-compatible settings', () => {
    const db = openDatabase(':memory:');
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
  });
});
