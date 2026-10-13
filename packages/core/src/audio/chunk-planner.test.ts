import { describe, expect, it } from 'vitest';

import { DEFAULT_CHUNK_PLAN_OPTIONS, planChunks } from './chunk-planner';
import type { ChunkPlan } from './chunk-planner';

const NO_PAD = { ...DEFAULT_CHUNK_PLAN_OPTIONS, padMs: 0 };
const span = (startS: number, endS: number) => ({ startMs: startS * 1000, endMs: endS * 1000 });
const bounds = (chunks: ChunkPlan[]) => chunks.map((c) => [c.startMs / 1000, c.endMs / 1000]);

describe('planChunks', () => {
  it('returns no chunks when there is no speech', () => {
    expect(planChunks(60_000, [])).toEqual([]);
  });

  it('makes one chunk for a short recording, trimmed to the speech', () => {
    expect(bounds(planChunks(20_000, [span(2, 18)], NO_PAD))).toEqual([[2, 18]]);
  });

  it('keeps a recording up to target + search in one chunk', () => {
    expect(bounds(planChunks(35_000, [span(0, 35)], NO_PAD))).toEqual([[0, 35]]);
  });

  it('cuts at the nearest silence within 5 seconds of the target', () => {
    const speech = [span(0, 27), span(28, 33), span(34, 60)];
    // Gaps start at 27 s (3 s from target) and 33 s (3 s past): ties go to the earlier one.
    expect(bounds(planChunks(60_000, speech, NO_PAD))).toEqual([
      [0, 27],
      [28, 60],
    ]);
  });

  it('prefers the silence closest to the target', () => {
    const speech = [span(0, 26), span(27, 31), span(32, 70)];
    expect(bounds(planChunks(70_000, speech, NO_PAD))[0]).toEqual([0, 31]);
  });

  it('cuts inside speech with an overlap when no silence is near the target', () => {
    expect(bounds(planChunks(70_000, [span(0, 70)], NO_PAD))).toEqual([
      [0, 30],
      [28.5, 58.5],
      [57, 70],
    ]);
  });

  it('cuts where a long silence begins when the target falls inside it', () => {
    const speech = [span(0, 10), span(100, 130)];
    expect(bounds(planChunks(130_000, speech, NO_PAD))).toEqual([
      [0, 10],
      [100, 130],
    ]);
  });

  it('skips leading and trailing silence', () => {
    expect(bounds(planChunks(600_000, [span(300, 310)], NO_PAD))).toEqual([[300, 310]]);
  });

  it('pads speech edges without going outside the recording', () => {
    expect(bounds(planChunks(10_000, [span(0.1, 9.9)]))).toEqual([[0, 10]]);
  });

  it('merges spans that touch after padding', () => {
    expect(bounds(planChunks(10_000, [span(1, 4), span(4.3, 8)]))).toEqual([[0.8, 8.2]]);
  });

  it('numbers chunks in order and never exceeds target + search', () => {
    const speech = Array.from({ length: 40 }, (_, i) => span(i * 15, i * 15 + 13));
    const chunks = planChunks(600_000, speech);
    expect(chunks.map((c) => c.index)).toEqual(chunks.map((_, i) => i));
    for (const c of chunks) {
      expect(c.endMs - c.startMs).toBeLessThanOrEqual(35_000);
    }
  });

  it('covers every speech span', () => {
    const speech = [span(5, 50), span(52, 53), span(90, 200), span(201, 260)];
    const chunks = planChunks(300_000, speech, NO_PAD);
    for (const s of speech) {
      for (let t = s.startMs; t < s.endMs; t += 100) {
        expect(chunks.some((c) => c.startMs <= t && t < c.endMs)).toBe(true);
      }
    }
  });

  it('is deterministic', () => {
    const speech = [span(1, 44), span(45, 99), span(120, 180)];
    expect(planChunks(200_000, speech)).toEqual(planChunks(200_000, [...speech].reverse()));
  });
});
