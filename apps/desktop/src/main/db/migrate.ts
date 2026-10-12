import type { DatabaseSync } from 'node:sqlite';

import type { Migration } from './migration-list';
import { inTransaction } from './transaction';

/** The database is newer than this app. Opening it could lose data, so we refuse. */
export class DatabaseTooNewError extends Error {
  constructor(
    readonly databaseVersion: number,
    readonly latestKnownVersion: number,
  ) {
    super(
      `Database schema version ${String(databaseVersion)} is newer than this app supports (${String(latestKnownVersion)})`,
    );
    this.name = 'DatabaseTooNewError';
  }
}

export function schemaVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get();
  return typeof row?.['user_version'] === 'number' ? row['user_version'] : 0;
}

/**
 * Applies every migration newer than the database's `user_version`, each in its own transaction
 * together with the version bump, so a failure leaves the database at the last good version.
 *
 * @returns the versions that were applied.
 */
export function migrate(db: DatabaseSync, migrations: readonly Migration[]): number[] {
  assertSequential(migrations);
  const latest = migrations.at(-1)?.version ?? 0;
  const current = schemaVersion(db);
  if (current > latest) {
    throw new DatabaseTooNewError(current, latest);
  }

  const applied: number[] = [];
  for (const migration of migrations.filter((m) => m.version > current)) {
    inTransaction(db, () => {
      db.exec(migration.sql);
      // PRAGMA cannot take bound parameters; the version is a validated integer.
      db.exec(`PRAGMA user_version = ${String(migration.version)}`);
    });
    applied.push(migration.version);
  }
  return applied;
}

function assertSequential(migrations: readonly Migration[]): void {
  migrations.forEach((migration, index) => {
    if (!Number.isInteger(migration.version) || migration.version !== index + 1) {
      throw new Error(
        `Migration ${migration.name} has version ${String(migration.version)}, expected ${String(index + 1)}`,
      );
    }
  });
}
