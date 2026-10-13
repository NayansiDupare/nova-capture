import { backoffDelayMs, DEFAULT_BACKOFF, ProviderError } from '@nova/core';

import type { Job, JobType, JobsRepo } from '../db/jobs-repo';
import { log } from '../log';

export type JobHandler = (job: Job) => Promise<void>;
export type JobOutcome = 'done' | 'retrying' | 'failed';

export type JobRunnerOptions = {
  readonly jobs: JobsRepo;
  readonly handlers: Readonly<Record<JobType, JobHandler>>;
  readonly now?: () => number;
  readonly random?: () => number;
  /** Chunks transcribe in parallel so a 10-min session meets the ~60 s budget (ARCHITECTURE.md §17). */
  readonly concurrency?: number;
  /** Attempts per job before it is marked failed (and the session needs a manual retry). */
  readonly maxAttempts?: number;
  readonly onSettled?: (job: Job, outcome: JobOutcome) => void;
};

export const DEFAULT_CONCURRENCY = 3;
export const DEFAULT_MAX_ATTEMPTS = 5;

/**
 * Runs due jobs from the persistent queue with bounded concurrency. Failures are retried with
 * exponential backoff while the error is retryable; permanent errors (bad key, unsupported
 * provider) fail at once so they do not burn money or time.
 */
export class JobRunner {
  private inFlight = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly concurrency: number;
  private readonly maxAttempts: number;

  constructor(private readonly options: JobRunnerOptions) {
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
    this.concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  }

  /** Claims as many due jobs as there are free slots and runs them. Resolves when they settle. */
  async tick(): Promise<void> {
    const free = this.concurrency - this.inFlight;
    if (free <= 0) {
      return;
    }
    const jobs = this.options.jobs.claimDue(this.now(), free);
    this.inFlight += jobs.length;
    await Promise.all(jobs.map((job) => this.run(job)));
  }

  /** Polls for due jobs every `intervalMs` until {@link JobRunner.stop}. */
  start(intervalMs = 1000): void {
    this.stop();
    this.timer = setInterval(() => {
      this.tick().catch((error: unknown) => {
        log.error('job runner tick failed', { error: String(error) });
      });
    }, intervalMs);
  }

  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async run(job: Job): Promise<void> {
    try {
      await this.options.handlers[job.type](job);
      this.options.jobs.complete(job.id);
      this.settle(job, 'done');
    } catch (error) {
      const attempts = job.attempts + 1;
      const message = error instanceof Error ? error.message : String(error);
      // Unknown errors (file read, DB) are retried too: bounded, and they cost nothing.
      const isRetryable = error instanceof ProviderError ? error.retryable : true;
      const retryAt =
        isRetryable && attempts < this.maxAttempts
          ? this.now() + backoffDelayMs(attempts, { ...DEFAULT_BACKOFF, random: this.random })
          : null;
      this.options.jobs.recordFailure(job.id, message, retryAt);
      log.warn('job attempt failed', {
        jobId: job.id,
        type: job.type,
        sessionId: job.sessionId,
        attempts,
        willRetry: retryAt !== null,
      });
      this.settle(job, retryAt === null ? 'failed' : 'retrying');
    } finally {
      this.inFlight--;
    }
  }

  private settle(job: Job, outcome: JobOutcome): void {
    try {
      this.options.onSettled?.(job, outcome);
    } catch (error) {
      log.error('job settle callback failed', { jobId: job.id, error: String(error) });
    }
  }
}
