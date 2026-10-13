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
  spool_path: z.string().nullable(),
  duration_ms: z.number().nullable(),
  speech_ratio: z.number().nullable(),
});

export type SessionRecord = SessionSnapshot & {
  readonly id: string;
  readonly startedAt: number;
  readonly captureSource: string | null;
  readonly spoolPath: string | null;
  /** Spool duration and speech share, known once the spool has been analyzed after stop. */
  readonly durationMs: number | null;
  readonly speechRatio: number | null;
};

export class SessionNotFoundError extends Error {
  constructor(readonly sessionId: string) {
    super(`Session ${sessionId} not found`);
    this.name = 'SessionNotFoundError';
  }
}

const COLUMNS =
  'id, state, error, started_at, capture_source, spool_path, duration_ms, speech_ratio';

/**
 * Persists capture sessions. Every state change goes through {@link SessionsRepo.transition},
 * so the stored state is always one the state machine allows (ARCHITECTURE.md §8).
 */
export class SessionsRepo {
  constructor(private readonly db: DatabaseSync) {}

  /** Records a new session by applying `start`, so it begins in `STARTING`. */
  create(input: {
    id: string;
    startedAt: number;
    captureSource: string | null;
    spoolPath: string | null;
  }): SessionRecord {
    const { state, error } = reduce(INITIAL_SNAPSHOT, { type: 'start' });
    this.db
      .prepare(
        `INSERT INTO sessions (id, state, error, started_at, capture_source, spool_path)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(input.id, state, error, input.startedAt, input.captureSource, input.spoolPath);
    return { ...input, state, error, durationMs: null, speechRatio: null };
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

  /** Stores the analysis of the finished spool. */
  recordAnalysis(id: string, analysis: { durationMs: number; speechRatio: number }): void {
    const { changes } = this.db
      .prepare('UPDATE sessions SET duration_ms = ?, speech_ratio = ? WHERE id = ?')
      .run(analysis.durationMs, analysis.speechRatio, id);
    if (changes === 0) {
      throw new SessionNotFoundError(id);
    }
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
    spoolPath: parsed.spool_path,
    durationMs: parsed.duration_ms,
    speechRatio: parsed.speech_ratio,
  };
}
