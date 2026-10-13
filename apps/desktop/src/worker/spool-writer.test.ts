import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bytesToPcm } from '@nova/core';

import { SpoolWriter } from './spool-writer';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nova-spool-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const samplesIn = (path: string) => [...bytesToPcm(new Uint8Array(readFileSync(path)))];

describe('SpoolWriter', () => {
  it('creates missing folders and writes nothing until flushed', () => {
    const path = join(dir, 'spool', 's1.pcm');
    const spool = new SpoolWriter(path);
    spool.append(Int16Array.from([1, 2]));
    expect(samplesIn(path)).toEqual([]);

    spool.flush();
    expect(samplesIn(path)).toEqual([1, 2]);
    expect(spool.bytesWritten).toBe(4);
    spool.close();
  });

  it('appends frames in order as little-endian PCM', () => {
    const path = join(dir, 's1.pcm');
    const spool = new SpoolWriter(path);
    spool.append(Int16Array.from([1, -1]));
    spool.append(Int16Array.from([32767]));
    spool.close();
    expect([...readFileSync(path)]).toEqual([1, 0, 0xff, 0xff, 0xff, 0x7f]);
  });

  it('continues an existing spool instead of truncating it', () => {
    const path = join(dir, 's1.pcm');
    writeFileSync(path, Uint8Array.from([5, 0]));
    const spool = new SpoolWriter(path);
    spool.append(Int16Array.from([6]));
    spool.close();
    expect(samplesIn(path)).toEqual([5, 6]);
  });

  it('drops and counts frames when the buffer is full', () => {
    const spool = new SpoolWriter(join(dir, 's1.pcm'), 2);
    expect(spool.append(Int16Array.from([1]))).toBe(true);
    expect(spool.append(Int16Array.from([2]))).toBe(true);
    expect(spool.append(Int16Array.from([3]))).toBe(false);
    expect(spool.droppedFrames).toBe(1);
    spool.close();
  });

  it('refuses frames after close and closes only once', () => {
    const spool = new SpoolWriter(join(dir, 's1.pcm'));
    spool.close();
    spool.close();
    expect(() => spool.append(Int16Array.from([1]))).toThrow(/closed/);
  });
});
