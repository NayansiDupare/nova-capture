import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { pcmToBytes } from '@nova/core';
import { speechPattern, tone } from '@nova/core/testing';

import { analyzeSpool, readSpoolLevels } from './spool-analyzer';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nova-analyze-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const spoolOf = (pcm: Int16Array) => {
  const path = join(dir, 'spool.pcm');
  writeFileSync(path, pcmToBytes(pcm));
  return path;
};

describe('analyzeSpool', () => {
  it('finds speech spans and duration in a spool file', async () => {
    const path = spoolOf(speechPattern(['silence', 1000], ['speech', 3000], ['silence', 2000]));
    expect(await analyzeSpool(path)).toEqual({
      durationMs: 6000,
      speech: [{ startMs: 1000, endMs: 4000 }],
      speechRatio: 0.5,
    });
  });

  it('reads a spool larger than one stream chunk', async () => {
    // 64 frames per stream chunk; 2 minutes is 1200 frames.
    const path = spoolOf(speechPattern(['speech', 60_000], ['silence', 60_000]));
    const { levelsDbfs } = await readSpoolLevels(path);
    expect(levelsDbfs).toHaveLength(1200);
    expect(levelsDbfs[0]).toBeCloseTo(-20, 0);
    expect(levelsDbfs[1199]).toBe(Number.NEGATIVE_INFINITY);
  });

  it('counts a trailing partial frame and clips spans to the duration', async () => {
    const path = spoolOf(tone(1050));
    const result = await analyzeSpool(path);
    expect(result.durationMs).toBe(1050);
    expect(result.speech).toEqual([{ startMs: 0, endMs: 1050 }]);
  });

  it('reports no speech for an empty spool', async () => {
    expect(await analyzeSpool(spoolOf(new Int16Array()))).toEqual({
      durationMs: 0,
      speech: [],
      speechRatio: 0,
    });
  });

  it('rejects a missing file', async () => {
    await expect(analyzeSpool(join(dir, 'missing.pcm'))).rejects.toThrow(/ENOENT/);
  });
});
