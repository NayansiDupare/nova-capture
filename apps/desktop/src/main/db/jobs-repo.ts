import type { DatabaseSync } from 'node:sqlite';

import { z } from 'zod';

import { inTransaction } from './transaction';

export const JOB_TYPES = ['transcribe_chunk', 'generate_note'] as const;
export type JobType = (typeof JOB_TYPES)[number];

/**
 * `pending` → `running` → `done`; a failed attempt goes back to `pending` with a later
 * `next_run_at`, or to `failed` once retries are exhausted or the error is permanent.
 */
export const JOB_STATUSES = ['pending', 'running', 'done', 'failed'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

const JobRowSchema = z.object({
  id: z.string(),
  type: z.enum(JOB_TYPES),
  session_id: z.string(),
  payload: z.string().nullable(),
  status: z.enum(JOB_STATUSES),
  attempts: z.number(),
  last_error: z.string().nullable(),
  next_run_at: z.number().nullable(),
});

export type Job = {
  readonly id: string;
  readonly type: JobType;
  readonly sessionId: string;
  /** Parsed JSON; each job handler validates its own payload shape. */
  readonly payload: unknown;
  readonly status: JobStatus;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly nextRunAt: number | null;
};

const COLUMNS = 'id, type, session_id, payload, status, attempts, last_error, next_run_at';

/** The persistent job queue (ARCHITECTURE.md §7 "Resilience"). Survives app restarts. */
export class JobsRepo {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * Adds jobs in one transaction, all due at `now`. Ids that already exist are left untouched,
   * so re-planning a session after a crash is safe.
   */
  enqueue(
    jobs: readonly { id: string; type: JobType; sessionId: string; payload: unknown }[],
    now: number,
  ): void {
    const insert = this.db.prepare(
      `INSERT INTO jobs (id, type, session_id, payload, status, attempts, next_run_at)
       VALUES (?, ?, ?, ?, 'pending', 0, ?)
       ON CONFLICT(id) DO NOTHING`,
    );
    inTransaction(this.db, () => {
      for (const job of jobs) {
        insert.run(job.id, job.type, job.sessionId, JSON.stringify(job.payload), now);
      }
    });
  }

  get(id: string): Job | undefined {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM jobs WHERE id = ?`).get(id);
    return row ? toJob(row) : undefined;
  }

  listBySession(sessionId: string): Job[] {
    return this.db
      .prepare(`SELECT ${COLUMNS} FROM jobs WHERE session_id = ? ORDER BY rowid`)
      .all(sessionId)
      .map(toJob);
  }

  /** Marks up to `limit` due jobs as running and returns them, oldest due first. */
  claimDue(now: number, limit: number): Job[] {
    return inTransaction(this.db, () => {
      const due = this.db
        .prepare(
          `SELECT ${COLUMNS} FROM jobs WHERE status = 'pending' AND next_run_at <= ?
           ORDER BY next_run_at, rowid LIMIT ?`,
        )
        .all(now, limit)
        .map(toJob);
      const markRunning = this.db.prepare("UPDATE jobs SET status = 'running' WHERE id = ?");
      for (const job of due) {
        markRunning.run(job.id);
      }
      return due.map((job) => ({ ...job, status: 'running' as const }));
    });
  }

  complete(id: string): void {
    this.db.prepare("UPDATE jobs SET status = 'done', last_error = NULL WHERE id = ?").run(id);
  }

  /**
   * Records a failed attempt. With `retryAt` the job runs again then; without it the job is
   * `failed` until {@link JobsRepo.retryFailed} is called.
   */
  recordFailure(id: string, error: string, retryAt: number | null): void {
    this.db
      .prepare(
        `UPDATE jobs SET attempts = attempts + 1, last_error = ?, status = ?, next_run_at = ?
         WHERE id = ?`,
      )
      .run(error, retryAt === null ? 'failed' : 'pending', retryAt, id);
  }

  /** Puts a session's failed jobs back in the queue with a fresh retry budget. */
  retryFailed(sessionId: string, now: number): number {
    const { changes } = this.db
      .prepare(
        `UPDATE jobs SET status = 'pending', attempts = 0, next_run_at = ?
         WHERE session_id = ? AND status = 'failed'`,
      )
      .run(now, sessionId);
    return Number(changes);
  }

  /**
   * Drops a discarded session's queued and failed jobs so they never run (or cost money).
   * A job already running finishes; its result is kept but unused.
   */
  cancelSession(sessionId: string): number {
    const { changes } = this.db
      .prepare("DELETE FROM jobs WHERE session_id = ? AND status IN ('pending', 'failed')")
      .run(sessionId);
    return Number(changes);
  }

  /** At startup: jobs left `running` by a crash are runnable again. */
  requeueInterrupted(now: number): number {
    const { changes } = this.db
      .prepare("UPDATE jobs SET status = 'pending', next_run_at = ? WHERE status = 'running'")
      .run(now);
    return Number(changes);
  }
}

function toJob(row: unknown): Job {
  const parsed = JobRowSchema.parse(row);
  return {
    id: parsed.id,
    type: parsed.type,
    sessionId: parsed.session_id,
    payload: parsed.payload === null ? null : (JSON.parse(parsed.payload) as unknown),
    status: parsed.status,
    attempts: parsed.attempts,
    lastError: parsed.last_error,
    nextRunAt: parsed.next_run_at,
  };
}
