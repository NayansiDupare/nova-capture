import { createReadStream } from 'node:fs';

import {
  bytesToPcm,
  detectSpeech,
  FRAME_MS,
  frameLevelDbfs,
  samplesForDurationMs,
  speechRatio,
} from '@nova/core';
import type { SpeechSpan } from '@nova/core';

const FRAME_BYTES = samplesForDurationMs(FRAME_MS) * 2;

export type SpoolAnalysis = {
  readonly durationMs: number;
  readonly speech: SpeechSpan[];
  readonly speechRatio: number;
};

/**
 * Per-frame levels of a spool file, read as a stream so an hour-long spool (~115 MB)
 * never sits in memory. A trailing partial frame counts as one frame.
 */
export async function readSpoolLevels(
  path: string,
): Promise<{ levelsDbfs: number[]; byteLength: number }> {
  const levelsDbfs: number[] = [];
  let carry = new Uint8Array(0);
  let byteLength = 0;

  for await (const chunk of createReadStream(path, { highWaterMark: FRAME_BYTES * 64 })) {
    const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(0);
    byteLength += bytes.length;
    const data = carry.length > 0 ? concat(carry, bytes) : bytes;
    const whole = data.length - (data.length % FRAME_BYTES);
    for (let offset = 0; offset < whole; offset += FRAME_BYTES) {
      levelsDbfs.push(frameLevelDbfs(bytesToPcm(data.subarray(offset, offset + FRAME_BYTES))));
    }
    carry = data.slice(whole);
  }
  if (carry.length >= 2) {
    levelsDbfs.push(frameLevelDbfs(bytesToPcm(carry)));
  }
  return { levelsDbfs, byteLength };
}

/**
 * Speech spans and duration of a finished spool. Derived from the file alone, so it gives
 * the same answer after a crash as after a normal stop.
 */
export async function analyzeSpool(path: string): Promise<SpoolAnalysis> {
  const { levelsDbfs, byteLength } = await readSpoolLevels(path);
  const durationMs = (Math.floor(byteLength / 2) / samplesForDurationMs(1000)) * 1000;
  const speech = detectSpeech(levelsDbfs).map((span) => ({
    startMs: span.startMs,
    endMs: Math.min(span.endMs, durationMs),
  }));
  return { durationMs, speech, speechRatio: speechRatio(speech, durationMs) };
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}
