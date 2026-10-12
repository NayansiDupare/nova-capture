import type { DatabaseSync } from 'node:sqlite';

/**
 * Runs `fn` inside a transaction: commits if it returns, rolls back if it throws.
 * node:sqlite has no transaction helper. Not re-entrant: do not nest calls.
 */
export function inTransaction<T>(db: DatabaseSync, fn: () => T): T {
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
