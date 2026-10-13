import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { decodeWav, pcmToBytes } from '@nova/core';

import { readChunkWav } from './read-chunk';

let dir: string;
let spoolPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nova-chunk-'));
  spoolPath = join(dir, 's1.pcm');
  // 1 s of audio where each sample's value is its index modulo 30000.
  writeFileSync(spoolPath, pcmToBytes(Int16Array.from({ length: 16_000 }, (_, i) => i % 30_000)));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('readChunkWav', () => {
  it('reads exactly the chunk’s samples as a WAV', async () => {
    const audio = await readChunkWav(spoolPath, { index: 3, startMs: 250, endMs: 500 });
    const { pcm, sampleRate } = decodeWav(audio.wav);

    expect(audio).toMatchObject({ index: 3, startMs: 250, endMs: 500 });
    expect(sampleRate).toBe(16_000);
    expect(pcm).toHaveLength(4000);
    expect(pcm[0]).toBe(4000);
    expect(pcm.at(-1)).toBe(7999);
  });

  it('clips a chunk that runs past the end of the spool', async () => {
    const { pcm } = decodeWav(
      (await readChunkWav(spoolPath, { index: 0, startMs: 900, endMs: 2000 })).wav,
    );
    expect(pcm).toHaveLength(1600);
  });

  it('rejects a missing spool', async () => {
    await expect(
      readChunkWav(join(dir, 'missing.pcm'), { index: 0, startMs: 0, endMs: 1 }),
    ).rejects.toThrow(/ENOENT/);
  });
});
