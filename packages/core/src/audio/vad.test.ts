import { describe, expect, it } from 'vitest';

import { detectSpeech, FRAME_MS, frameLevelDbfs, speechRatio } from './vad';

const SPEECH = -20;
const SILENT = Number.NEGATIVE_INFINITY;

/** Per-frame levels from a pattern like [['speech', 2000], ['silence', 1000]]. */
const levels = (...parts: [kind: 'speech' | 'silence', ms: number][]) =>
  parts.flatMap(([kind, ms]) =>
    Array<number>(ms / FRAME_MS).fill(kind === 'speech' ? SPEECH : SILENT),
  );

describe('frameLevelDbfs', () => {
  it('is -Infinity for digital silence and empty frames', () => {
    expect(frameLevelDbfs(new Int16Array(1600))).toBe(Number.NEGATIVE_INFINITY);
    expect(frameLevelDbfs(new Int16Array())).toBe(Number.NEGATIVE_INFINITY);
  });

  it('is about 0 dBFS for a full-scale square wave', () => {
    const frame = Int16Array.from({ length: 1600 }, (_, i) => (i % 2 ? 32767 : -32768));
    expect(frameLevelDbfs(frame)).toBeCloseTo(0, 1);
  });

  it('is about -3 dBFS for a full-scale sine', () => {
    const frame = Int16Array.from({ length: 1600 }, (_, i) =>
      Math.round(32767 * Math.sin((2 * Math.PI * 440 * i) / 16000)),
    );
    expect(frameLevelDbfs(frame)).toBeCloseTo(-3.01, 1);
  });
});

describe('detectSpeech', () => {
  it('finds speech between silences', () => {
    expect(detectSpeech(levels(['silence', 1000], ['speech', 2000], ['silence', 1000]))).toEqual([
      { startMs: 1000, endMs: 3000 },
    ]);
  });

  it('handles speech touching both ends', () => {
    expect(detectSpeech(levels(['speech', 1000]))).toEqual([{ startMs: 0, endMs: 1000 }]);
  });

  it('bridges pauses shorter than minSilenceMs', () => {
    const spans = detectSpeech(levels(['speech', 1000], ['silence', 400], ['speech', 1000]));
    expect(spans).toEqual([{ startMs: 0, endMs: 2400 }]);
  });

  it('keeps pauses of minSilenceMs or longer as gaps', () => {
    const spans = detectSpeech(levels(['speech', 1000], ['silence', 500], ['speech', 1000]));
    expect(spans).toEqual([
      { startMs: 0, endMs: 1000 },
      { startMs: 1500, endMs: 2500 },
    ]);
  });

  it('drops blips shorter than minSpeechMs', () => {
    expect(detectSpeech(levels(['silence', 1000], ['speech', 200], ['silence', 1000]))).toEqual([]);
  });

  it('treats a level exactly at the threshold as speech', () => {
    expect(detectSpeech(Array<number>(5).fill(-45))).toEqual([{ startMs: 0, endMs: 500 }]);
  });

  it('returns nothing for all silence or no frames', () => {
    expect(detectSpeech(levels(['silence', 10_000]))).toEqual([]);
    expect(detectSpeech([])).toEqual([]);
  });
});

describe('speechRatio', () => {
  it('is the share of time covered by speech', () => {
    expect(
      speechRatio(
        [
          { startMs: 0, endMs: 2500 },
          { startMs: 5000, endMs: 7500 },
        ],
        10_000,
      ),
    ).toBe(0.5);
  });

  it('is 0 for an empty recording', () => {
    expect(speechRatio([], 0)).toBe(0);
  });
});
