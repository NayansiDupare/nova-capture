import type { DatabaseSync } from 'node:sqlite';

/**
 * Runs `fn` inside a transaction: commits if it returns, rolls back if it throws.
 * node:sqlite has no transaction helper. A nested call joins the outer transaction, so
 * repository writes can be combined atomically (saving a note and marking its session SAVED).
 */
export function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
  if (db.isTransaction) {
    // The outer call commits, or rolls back if this throws.
    return fn();
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
