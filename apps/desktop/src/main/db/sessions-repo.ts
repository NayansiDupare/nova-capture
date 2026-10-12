import type { DatabaseSync } from 'node:sqlite';

import { z } from 'zod';

import { INITIAL_SNAPSHOT, reduce, SessionStateSchema, TERMINAL_STATES } from '@nova/core';
import type { SessionEvent, SessionSnapshot, SessionState } from '@nova/core';

import { inTransaction } from './transaction';

const SessionRowSchema = z.object({
  id: z.string(),
  state: SessionStateSchema,
  error: z.string().nullable(),
  started_at: z.number(),
  capture_source: z.string().nullable(),
});

export type SessionRecord = SessionSnapshot & {
  readonly id: string;
  readonly startedAt: number;
  readonly captureSource: string | null;
};

export class SessionNotFoundError extends Error {
  constructor(readonly sessionId: string) {
    super(`Session ${sessionId} not found`);
    this.name = 'SessionNotFoundError';
  }
}

const COLUMNS = 'id, state, error, started_at, capture_source';

/**
 * Persists capture sessions. Every state change goes through {@link SessionsRepo.transition},
 * so the stored state is always one the state machine allows (ARCHITECTURE.md §8).
 */
export class SessionsRepo {
  constructor(private readonly db: DatabaseSync) {}

  /** Records a new session by applying `start`, so it begins in `STARTING`. */
  create(input: { id: string; startedAt: number; captureSource: string | null }): SessionRecord {
    const { state, error } = reduce(INITIAL_SNAPSHOT, { type: 'start' });
    this.db
      .prepare(
        'INSERT INTO sessions (id, state, error, started_at, capture_source) VALUES (?, ?, ?, ?, ?)',
      )
      .run(input.id, state, error, input.startedAt, input.captureSource);
    return { ...input, state, error };
  }

  get(id: string): SessionRecord | undefined {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM sessions WHERE id = ?`).get(id);
    return row ? toRecord(row) : undefined;
  }

  /**
   * Applies `event` to the stored session and saves the result in one transaction.
   *
   * @throws {SessionNotFoundError} if the session does not exist.
   * @throws {InvalidTransitionError} if the event is not allowed; nothing is written.
   */
  transition(id: string, event: SessionEvent): SessionRecord {
    return inTransaction(this.db, () => {
      const current = this.get(id);
      if (!current) {
        throw new SessionNotFoundError(id);
      }
      const next = reduce(current, event);
      this.db
        .prepare('UPDATE sessions SET state = ?, error = ? WHERE id = ?')
        .run(next.state, next.error, id);
      return { ...current, ...next };
    });
  }

  /** Sessions the app did not finish, oldest first. Offered for recovery at launch. */
  listUnfinished(): SessionRecord[] {
    const placeholders = TERMINAL_STATES.map(() => '?').join(', ');
    return this.db
      .prepare(
        `SELECT ${COLUMNS} FROM sessions WHERE state NOT IN (${placeholders}) ORDER BY started_at, id`,
      )
      .all(...TERMINAL_STATES)
      .map(toRecord);
  }
}

function toRecord(row: unknown): SessionRecord {
  const parsed = SessionRowSchema.parse(row);
  return {
    id: parsed.id,
    state: parsed.state satisfies SessionState,
    error: parsed.error,
    startedAt: parsed.started_at,
    captureSource: parsed.capture_source,
  };
}
