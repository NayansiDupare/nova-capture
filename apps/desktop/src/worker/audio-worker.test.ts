import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bytesToPcm, SILENT_LEVEL_DBFS } from '@nova/core';
import type { WorkerToMain } from '@nova/core';
import { silence, tone } from '@nova/core/testing';

import { AudioWorker } from './audio-worker';
import { SpoolWriter } from './spool-writer';

/** A spool whose disk "fills up" on the first flush. */
class DiskFullSpool extends SpoolWriter {
  override flush(): void {
    throw new Error('ENOSPC: no space left on device');
  }
}

let dir: string;
let sent: WorkerToMain[];
let worker: AudioWorker;
const spoolPath = () => join(dir, 's1.pcm');
const samplesIn = (path: string) => bytesToPcm(new Uint8Array(readFileSync(path)));
const ofType = <T extends WorkerToMain['type']>(type: T) =>
  sent.filter((m): m is Extract<WorkerToMain, { type: T }> => m.type === type);

beforeEach(() => {
  vi.useFakeTimers();
  dir = mkdtempSync(join(tmpdir(), 'nova-worker-'));
  sent = [];
  worker = new AudioWorker({ send: (m) => sent.push(m), flushIntervalMs: 1000 });
});
afterEach(() => {
  worker.stop();
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

describe('AudioWorker', () => {
  it('spools frames and reports stopped with the byte count', () => {
    worker.start('s1', spoolPath());
    worker.frame(tone(100));
    worker.frame(tone(100));
    worker.stop();

    expect(sent[0]).toEqual({ type: 'started', sessionId: 's1' });
    expect(ofType('stopped')).toEqual([
      { type: 'stopped', sessionId: 's1', bytesWritten: 6400, droppedFrames: 0 },
    ]);
    expect(samplesIn(spoolPath())).toHaveLength(3200);
  });

  it('flushes to disk on the interval, so a crash loses at most one interval', () => {
    worker.start('s1', spoolPath());
    worker.frame(tone(100));
    expect(samplesIn(spoolPath())).toHaveLength(0);

    vi.advanceTimersByTime(1000);
    expect(samplesIn(spoolPath())).toHaveLength(1600);
  });

  it('reports the loudest level every three frames', () => {
    worker.start('s1', spoolPath());
    worker.frame(tone(100, -30));
    worker.frame(tone(100, -10));
    expect(ofType('level')).toEqual([]);
    worker.frame(silence(100));

    const [level] = ofType('level');
    expect(level?.dbfs).toBeCloseTo(-10, 0);
  });

  it('reports digital silence as the silent floor, not -Infinity', () => {
    worker.start('s1', spoolPath());
    for (let i = 0; i < 3; i++) worker.frame(silence(100));
    expect(ofType('level')[0]?.dbfs).toBe(SILENT_LEVEL_DBFS);
  });

  it('does not spool while paused', () => {
    worker.start('s1', spoolPath());
    worker.frame(tone(100));
    worker.pause();
    worker.frame(tone(100));
    worker.resume();
    worker.frame(tone(100));
    worker.stop();
    expect(samplesIn(spoolPath())).toHaveLength(3200);
  });

  it.each([
    ['a non-frame', { not: 'audio' }],
    ['a Float32Array', new Float32Array(1600)],
    ['an empty frame', new Int16Array()],
    ['an oversized frame', new Int16Array(20_000)],
  ])('ignores %s', (_label, data) => {
    worker.start('s1', spoolPath());
    worker.frame(data);
    worker.stop();
    expect(ofType('stopped')[0]?.bytesWritten).toBe(0);
  });

  it('ignores frames when not capturing', () => {
    worker.frame(tone(100));
    expect(sent).toEqual([]);
  });

  it('refuses a second capture while one is running', () => {
    worker.start('s1', spoolPath());
    worker.start('s2', join(dir, 's2.pcm'));
    expect(ofType('error')).toEqual([
      { type: 'error', sessionId: 's2', message: 'Already capturing session s1' },
    ]);
    expect(worker.activeSessionId).toBe('s1');
  });

  it('reports an error when the spool cannot be opened', () => {
    const failing = new AudioWorker({
      send: (m) => sent.push(m),
      openSpool: () => {
        throw new Error('EACCES: permission denied');
      },
    });
    failing.start('s1', spoolPath());
    expect(ofType('error')[0]).toMatchObject({ sessionId: 's1', message: /EACCES/ });
    expect(failing.activeSessionId).toBeUndefined();
  });

  it('ends the capture with an error when the disk fills up', () => {
    const failing = new AudioWorker({
      send: (m) => sent.push(m),
      openSpool: (path) => new DiskFullSpool(path),
      flushIntervalMs: 1000,
    });
    failing.start('s1', spoolPath());
    failing.frame(tone(100));
    vi.advanceTimersByTime(1000);

    expect(ofType('error')).toEqual([
      {
        type: 'error',
        sessionId: 's1',
        message: 'Spool write failed: ENOSPC: no space left on device',
      },
    ]);
    expect(failing.activeSessionId).toBeUndefined();
  });

  it('reports a failed final flush on stop as an error, not stopped', () => {
    const failing = new AudioWorker({
      send: (m) => sent.push(m),
      openSpool: (path) => new DiskFullSpool(path),
    });
    failing.start('s1', spoolPath());
    failing.frame(tone(100));
    failing.stop();
    expect(ofType('stopped')).toEqual([]);
    expect(ofType('error')[0]).toMatchObject({ sessionId: 's1' });
  });

  it('analyzes a spool and replies with the request id', async () => {
    const analyzing = new AudioWorker({
      send: (m) => sent.push(m),
      analyze: () => Promise.resolve({ durationMs: 5000, speech: [], speechRatio: 0 }),
    });
    await analyzing.analyze('r1', spoolPath());
    expect(sent).toEqual([
      { type: 'analyzed', requestId: 'r1', durationMs: 5000, speech: [], speechRatio: 0 },
    ]);
  });

  it('replies with an error when analysis fails', async () => {
    await worker.analyze('r1', join(dir, 'missing.pcm'));
    expect(ofType('error')[0]).toMatchObject({ requestId: 'r1', message: /Cannot analyze spool/ });
  });
});
