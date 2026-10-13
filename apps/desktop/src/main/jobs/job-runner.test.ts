import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProviderError } from '@nova/core';

import { JobsRepo } from '../db/jobs-repo';
import type { Job } from '../db/jobs-repo';
import { openDatabase } from '../db/open-database';
import { log } from '../log';
import { JobRunner } from './job-runner';
import type { JobHandler, JobOutcome } from './job-runner';

let clock: number;
let settled: [string, JobOutcome][];
const noop: JobHandler = () => Promise.resolve();

const setup = (
  handler: JobHandler,
  options: { concurrency?: number; maxAttempts?: number } = {},
) => {
  const jobs = new JobsRepo(openDatabase(':memory:'));
  const runner = new JobRunner({
    jobs,
    handlers: { transcribe_chunk: handler, generate_note: noop },
    now: () => clock,
    random: () => 0,
    onSettled: (job, outcome) => settled.push([job.id, outcome]),
    ...options,
  });
  const add = (...ids: string[]) => {
    jobs.enqueue(
      ids.map((id) => ({ id, type: 'transcribe_chunk', sessionId: 's1', payload: null })),
      clock,
    );
  };
  return { jobs, runner, add };
};

beforeEach(() => {
  clock = 1_000_000;
  settled = [];
  vi.spyOn(log, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('JobRunner', () => {
  it('runs due jobs and marks them done', async () => {
    const { jobs, runner, add } = setup(noop);
    add('j1', 'j2');
    await runner.tick();
    expect(jobs.get('j1')?.status).toBe('done');
    expect(settled).toEqual([
      ['j1', 'done'],
      ['j2', 'done'],
    ]);
  });

  it('runs at most `concurrency` jobs at once', async () => {
    let running = 0;
    let peak = 0;
    const slow: JobHandler = async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
    };
    const { runner, add } = setup(slow, { concurrency: 2 });
    add('a', 'b', 'c', 'd');

    await Promise.all([runner.tick(), runner.tick()]);
    await runner.tick();

    expect(peak).toBe(2);
    expect(settled).toHaveLength(4);
  });

  it('retries a retryable failure later with growing backoff', async () => {
    const { jobs, runner, add } = setup(() =>
      Promise.reject(new ProviderError('HTTP 503', 'groq', true, 503)),
    );
    add('j1');

    await runner.tick();
    const first = jobs.get('j1');
    expect(first).toMatchObject({ status: 'pending', attempts: 1, lastError: 'HTTP 503' });
    // Not due yet.
    await runner.tick();
    expect(jobs.get('j1')?.attempts).toBe(1);

    clock = first?.nextRunAt ?? 0;
    await runner.tick();
    const second = jobs.get('j1');
    expect(second?.attempts).toBe(2);
    expect((second?.nextRunAt ?? 0) - clock).toBeGreaterThan((first?.nextRunAt ?? 0) - 1_000_000);
    expect(settled.map(([, o]) => o)).toEqual(['retrying', 'retrying']);
  });

  it('fails a permanent error at once', async () => {
    const { jobs, runner, add } = setup(() =>
      Promise.reject(new ProviderError('Invalid API Key', 'groq', false, 401)),
    );
    add('j1');
    await runner.tick();
    expect(jobs.get('j1')).toMatchObject({
      status: 'failed',
      attempts: 1,
      lastError: 'Invalid API Key',
    });
    expect(settled).toEqual([['j1', 'failed']]);
  });

  it('gives up after maxAttempts', async () => {
    const { jobs, runner, add } = setup(() => Promise.reject(new Error('disk read failed')), {
      maxAttempts: 3,
    });
    add('j1');
    for (let i = 0; i < 3; i++) {
      clock = jobs.get('j1')?.nextRunAt ?? clock;
      await runner.tick();
    }
    expect(jobs.get('j1')).toMatchObject({ status: 'failed', attempts: 3 });
    expect(settled.map(([, o]) => o)).toEqual(['retrying', 'retrying', 'failed']);
  });

  it('keeps going when the settle callback throws', async () => {
    const jobs = new JobsRepo(openDatabase(':memory:'));
    const error = vi.spyOn(log, 'error').mockImplementation(() => undefined);
    const runner = new JobRunner({
      jobs,
      handlers: { transcribe_chunk: noop, generate_note: noop },
      now: () => clock,
      onSettled: () => {
        throw new Error('listener bug');
      },
    });
    jobs.enqueue([{ id: 'j1', type: 'transcribe_chunk', sessionId: 's1', payload: null }], clock);
    await runner.tick();
    expect(jobs.get('j1')?.status).toBe('done');
    expect(error).toHaveBeenCalled();
  });

  it('polls on an interval until stopped', async () => {
    vi.useFakeTimers();
    const ran: Job[] = [];
    const { runner, add } = setup((job) => {
      ran.push(job);
      return Promise.resolve();
    });
    add('j1');
    runner.start(500);
    await vi.advanceTimersByTimeAsync(500);
    runner.stop();
    add('j2');
    await vi.advanceTimersByTimeAsync(2000);
    vi.useRealTimers();
    expect(ran.map((j) => j.id)).toEqual(['j1']);
  });
});
