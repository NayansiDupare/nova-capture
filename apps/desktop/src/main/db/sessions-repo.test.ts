import { describe, expect, it } from 'vitest';

import { InvalidTransitionError } from '@nova/core';

import { openDatabase } from './open-database';
import { SessionNotFoundError, SessionsRepo } from './sessions-repo';

const setup = () => {
  const repo = new SessionsRepo(openDatabase(':memory:'));
  const create = (id: string, startedAt = 1000) =>
    repo.create({
      id,
      startedAt,
      captureSource: 'electron-loopback',
      spoolPath: `/spool/${id}.pcm`,
    });
  return { repo, create };
};

describe('SessionsRepo', () => {
  it('creates a session in STARTING', () => {
    const { repo, create } = setup();
    const created = create('s1');

    expect(created).toEqual({
      id: 's1',
      state: 'STARTING',
      error: null,
      startedAt: 1000,
      captureSource: 'electron-loopback',
      spoolPath: '/spool/s1.pcm',
      durationMs: null,
      speechRatio: null,
    });
    expect(repo.get('s1')).toEqual(created);
  });

  it('stores the spool analysis', () => {
    const { repo, create } = setup();
    create('s1');
    repo.recordAnalysis('s1', { durationMs: 120_000, speechRatio: 0.75 });
    expect(repo.get('s1')).toMatchObject({ durationMs: 120_000, speechRatio: 0.75 });
  });

  it('throws when recording analysis for an unknown session', () => {
    expect(() => {
      setup().repo.recordAnalysis('nope', { durationMs: 1, speechRatio: 0 });
    }).toThrow(SessionNotFoundError);
  });

  it('returns undefined for an unknown session', () => {
    expect(setup().repo.get('nope')).toBeUndefined();
  });

  it('persists every transition', () => {
    const { repo, create } = setup();
    create('s1');

    repo.transition('s1', { type: 'started' });
    repo.transition('s1', { type: 'captureLost', error: 'Audio device disconnected' });

    expect(repo.get('s1')).toMatchObject({ state: 'STOPPING', error: 'Audio device disconnected' });
  });

  it('writes nothing on an invalid transition', () => {
    const { repo, create } = setup();
    create('s1');

    expect(() => repo.transition('s1', { type: 'save' })).toThrow(InvalidTransitionError);
    expect(repo.get('s1')).toMatchObject({ state: 'STARTING', error: null });
  });

  it('throws for an unknown session', () => {
    expect(() => setup().repo.transition('nope', { type: 'started' })).toThrow(
      SessionNotFoundError,
    );
  });

  it('lists only unfinished sessions, oldest first', () => {
    const { repo, create } = setup();
    create('saved', 1);
    create('newer', 3);
    create('older', 2);
    create('failed', 4);
    for (const type of [
      'started',
      'stop',
      'stopped',
      'transcribed',
      'generated',
      'save',
    ] as const) {
      repo.transition('saved', { type });
    }
    repo.transition('failed', { type: 'startFailed', error: 'Permission denied' });
    repo.transition('older', { type: 'started' });

    expect(repo.listUnfinished().map((s) => [s.id, s.state])).toEqual([
      ['older', 'LISTENING'],
      ['newer', 'STARTING'],
    ]);
  });

  it('rejects a stored row with an unknown state instead of guessing', () => {
    const db = openDatabase(':memory:');
    db.prepare("INSERT INTO sessions (id, state, started_at) VALUES ('s1', 'WARPING', 1)").run();
    expect(() => new SessionsRepo(db).get('s1')).toThrow();
  });
});
