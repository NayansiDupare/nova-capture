import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { planChunks } from '@nova/core';
import type { WorkerToMain } from '@nova/core';
import { FakeAudioSource, speechPattern } from '@nova/core/testing';

import { AudioWorker } from '../audio-worker';
import { analyzeSpool } from '../spool-analyzer';

// TESTING.md §3.2: replay audio through the real worker, spool, analyzer and chunk planner.

let dir: string;
beforeEach(() => {
  vi.useFakeTimers();
  dir = mkdtempSync(join(tmpdir(), 'nova-pipeline-'));
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

let captures = 0;

/** Plays `pcm` in real time: 10 frames (1 s), then one flush interval, and so on. */
async function capture(pcm: Int16Array) {
  const sent: WorkerToMain[] = [];
  const worker = new AudioWorker({ send: (m) => sent.push(m), flushIntervalMs: 1000 });
  // Spools are append-only, so every capture gets its own file.
  const spoolPath = join(dir, `session-${String(++captures)}.pcm`);
  const source = new FakeAudioSource(pcm, { manual: true });

  worker.start('s1', spoolPath);
  await source.start({ kind: 'system' }, (frame) => {
    worker.frame(frame);
  });
  while (source.remainingFrames > 0) {
    source.emit(10);
    vi.advanceTimersByTime(1000);
  }
  worker.stop();
  return { sent, analysis: await analyzeSpool(spoolPath) };
}

describe('capture pipeline', () => {
  it('turns a 2-minute lecture with pauses into chunks covering all speech', async () => {
    const lecture = speechPattern(
      ['silence', 2000],
      ['speech', 25_000],
      ['silence', 1500],
      ['speech', 40_000],
      ['silence', 800],
      ['speech', 45_000],
      ['silence', 5700],
    );

    const { sent, analysis } = await capture(lecture);

    expect(sent.at(-1)).toMatchObject({ type: 'stopped', droppedFrames: 0 });
    expect(analysis.durationMs).toBe(120_000);
    expect(analysis.speech).toHaveLength(3);
    expect(analysis.speechRatio).toBeCloseTo(110 / 120, 2);

    const chunks = planChunks(analysis.durationMs, analysis.speech);
    expect(chunks.length).toBeGreaterThanOrEqual(4);
    expect(chunks[0]?.startMs).toBe(1800);
    expect(chunks.at(-1)?.endMs).toBe(114_500);
    for (const chunk of chunks) {
      expect(chunk.endMs - chunk.startMs).toBeLessThanOrEqual(35_000);
    }
  });

  it('flags mostly silent audio with a low speech ratio and no chunks for pure silence', async () => {
    const { analysis } = await capture(speechPattern(['silence', 28_000], ['speech', 2000]));
    expect(analysis.speechRatio).toBeLessThan(0.1);

    const { analysis: silent } = await capture(speechPattern(['silence', 10_000]));
    expect(planChunks(silent.durationMs, silent.speech)).toEqual([]);
  });

  it('keeps audio written before the capture ended early', async () => {
    const pcm = speechPattern(['speech', 10_000]);
    const sent: WorkerToMain[] = [];
    const worker = new AudioWorker({ send: (m) => sent.push(m), flushIntervalMs: 1000 });
    const spoolPath = join(dir, 'session.pcm');
    const source = new FakeAudioSource(pcm, { manual: true });
    worker.start('s1', spoolPath);
    await source.start({ kind: 'system' }, (frame) => {
      worker.frame(frame);
    });

    source.emit(40); // 4 s of audio, then the app "crashes" after the next flush.
    vi.advanceTimersByTime(1000);

    const analysis = await analyzeSpool(spoolPath);
    expect(analysis.durationMs).toBe(4000);
    expect(analysis.speech).toEqual([{ startMs: 0, endMs: 4000 }]);
    worker.stop();
  });
});
