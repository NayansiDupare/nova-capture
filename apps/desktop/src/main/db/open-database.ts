import { DatabaseSync } from 'node:sqlite';

import { migrate } from './migrate';
import { MIGRATIONS } from './migration-list';

/**
 * Opens (or creates) the app database and brings its schema up to date.
 * Pass `':memory:'` in tests.
 */
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA journal_mode = WAL');
    // FULL rather than NORMAL: a committed session transition must survive a power cut (PRD.md §7).
    db.exec('PRAGMA synchronous = FULL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    migrate(db, MIGRATIONS);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
