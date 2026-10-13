import { describe, expect, it } from 'vitest';

import { JobsRepo } from './jobs-repo';
import { openDatabase } from './open-database';

const setup = () => {
  const repo = new JobsRepo(openDatabase(':memory:'));
  const add = (ids: string[], now = 1000, sessionId = 's1') => {
    repo.enqueue(
      ids.map((id, i) => ({ id, type: 'transcribe_chunk', sessionId, payload: { chunkIndex: i } })),
      now,
    );
  };
  return { repo, add };
};

describe('JobsRepo', () => {
  it('enqueues pending jobs with their payload', () => {
    const { repo, add } = setup();
    add(['j1']);
    expect(repo.get('j1')).toEqual({
      id: 'j1',
      type: 'transcribe_chunk',
      sessionId: 's1',
      payload: { chunkIndex: 0 },
      status: 'pending',
      attempts: 0,
      lastError: null,
      nextRunAt: 1000,
    });
  });

  it('claims due jobs up to the limit and marks them running', () => {
    const { repo, add } = setup();
    add(['j1', 'j2', 'j3']);

    const claimed = repo.claimDue(1000, 2);

    expect(claimed.map((j) => [j.id, j.status])).toEqual([
      ['j1', 'running'],
      ['j2', 'running'],
    ]);
    expect(repo.get('j1')?.status).toBe('running');
    expect(repo.claimDue(1000, 5).map((j) => j.id)).toEqual(['j3']);
  });

  it('does not claim jobs that are not due yet', () => {
    const { repo, add } = setup();
    add(['j1'], 5000);
    expect(repo.claimDue(4999, 5)).toEqual([]);
    expect(repo.claimDue(5000, 5)).toHaveLength(1);
  });

  it('schedules a retry after a failed attempt', () => {
    const { repo, add } = setup();
    add(['j1']);
    repo.claimDue(1000, 1);

    repo.recordFailure('j1', 'HTTP 503', 9000);

    expect(repo.get('j1')).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: 'HTTP 503',
      nextRunAt: 9000,
    });
  });

  it('marks a job failed when no retry is scheduled, until retried', () => {
    const { repo, add } = setup();
    add(['j1', 'j2']);
    repo.claimDue(1000, 2);
    repo.recordFailure('j1', 'HTTP 401', null);
    repo.complete('j2');

    expect(repo.get('j1')).toMatchObject({ status: 'failed', attempts: 1 });
    expect(repo.retryFailed('s1', 2000)).toBe(1);
    expect(repo.get('j1')).toMatchObject({ status: 'pending', attempts: 0, nextRunAt: 2000 });
    expect(repo.get('j2')?.status).toBe('done');
  });

  it('requeues jobs left running by a crash', () => {
    const { repo, add } = setup();
    add(['j1']);
    repo.claimDue(1000, 1);
    expect(repo.requeueInterrupted(3000)).toBe(1);
    expect(repo.get('j1')).toMatchObject({ status: 'pending', nextRunAt: 3000 });
  });

  it('lists a session’s jobs in creation order', () => {
    const { repo, add } = setup();
    add(['a', 'b']);
    add(['other'], 1000, 's2');
    expect(repo.listBySession('s1').map((j) => j.id)).toEqual(['a', 'b']);
  });

  it('leaves existing jobs untouched when enqueued again', () => {
    const { repo, add } = setup();
    add(['j1']);
    repo.claimDue(1000, 1);
    repo.complete('j1');

    add(['j1', 'j2'], 5000);

    expect(repo.get('j1')).toMatchObject({ status: 'done', nextRunAt: 1000 });
    expect(repo.get('j2')).toMatchObject({ status: 'pending', nextRunAt: 5000 });
  });
  it('cancels a session’s queued and failed jobs but keeps finished ones', () => {
    const { repo, add } = setup();
    add(['done', 'failed', 'pending']);
    add(['other'], 1000, 's2');
    repo.claimDue(1000, 2);
    repo.complete('done');
    repo.recordFailure('failed', 'HTTP 401', null);

    expect(repo.cancelSession('s1')).toBe(2);
    expect(repo.listBySession('s1').map((j) => j.id)).toEqual(['done']);
    expect(repo.get('other')).toBeDefined();
  });
});
