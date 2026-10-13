import { open } from 'node:fs/promises';

import { samplesForDurationMs, WAV_HEADER_BYTES, wavHeader } from '@nova/core';
import type { AudioChunk, ChunkPlan } from '@nova/core';

/**
 * Reads one planned chunk from a spool file as a WAV. Only the chunk's bytes are read,
 * so hour-long spools are never loaded whole. A chunk past the end of the file is clipped.
 */
export async function readChunkWav(spoolPath: string, chunk: ChunkPlan): Promise<AudioChunk> {
  const startByte = samplesForDurationMs(chunk.startMs) * 2;
  const endByte = samplesForDurationMs(chunk.endMs) * 2;
  const file = await open(spoolPath, 'r');
  try {
    const data = new Uint8Array(Math.max(0, endByte - startByte));
    const { bytesRead } = await file.read(data, 0, data.length, startByte);
    const pcm = data.subarray(0, bytesRead - (bytesRead % 2));
    const wav = new Uint8Array(WAV_HEADER_BYTES + pcm.length);
    wav.set(wavHeader(pcm.length));
    wav.set(pcm, WAV_HEADER_BYTES);
    return { index: chunk.index, startMs: chunk.startMs, endMs: chunk.endMs, wav };
  } finally {
    await file.close();
  }
}
