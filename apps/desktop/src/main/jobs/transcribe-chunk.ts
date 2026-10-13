import { z } from 'zod';

import type { ChunkPlan, SpeechToTextProvider } from '@nova/core';

import type { JobHandler } from './job-runner';
import type { Job } from '../db/jobs-repo';
import type { SessionsRepo } from '../db/sessions-repo';
import type { TranscriptChunksRepo } from '../db/transcript-chunks-repo';
import type { UsageRepo } from '../db/usage-repo';
import { readChunkWav } from '../spool/read-chunk';

export const TranscribeChunkPayloadSchema = z.object({
  chunkIndex: z.number().int().nonnegative(),
  startMs: z.number().nonnegative(),
  endMs: z.number().positive(),
});
export type TranscribeChunkPayload = z.infer<typeof TranscribeChunkPayloadSchema>;

/** Job id for a chunk; stable so re-planning after a crash cannot enqueue duplicates. */
export const transcribeJobId = (sessionId: string, chunkIndex: number) =>
  `${sessionId}:transcribe:${String(chunkIndex)}`;

export function transcribeJobFor(sessionId: string, chunk: ChunkPlan) {
  return {
    id: transcribeJobId(sessionId, chunk.index),
    type: 'transcribe_chunk' as const,
    sessionId,
    payload: {
      chunkIndex: chunk.index,
      startMs: chunk.startMs,
      endMs: chunk.endMs,
    } satisfies TranscribeChunkPayload,
  };
}

/**
 * Transcribes one chunk: reads it from the spool, calls the active STT provider, saves the
 * result and logs usage. The spool is only read, never modified (AGENTS.md §4.5).
 */
export function createTranscribeChunkHandler(deps: {
  sessions: SessionsRepo;
  chunks: TranscriptChunksRepo;
  usage: UsageRepo;
  getProvider: () => SpeechToTextProvider;
  now?: () => number;
}): JobHandler {
  const now = deps.now ?? Date.now;
  return async (job: Job) => {
    const payload = TranscribeChunkPayloadSchema.parse(job.payload);
    const spoolPath = deps.sessions.get(job.sessionId)?.spoolPath;
    if (!spoolPath) {
      throw new Error(`Session ${job.sessionId} has no spool file`);
    }
    const chunk: ChunkPlan = {
      index: payload.chunkIndex,
      startMs: payload.startMs,
      endMs: payload.endMs,
    };
    const audio = await readChunkWav(spoolPath, chunk);
    const provider = deps.getProvider();
    const result = await provider.transcribeChunk(audio, {});

    deps.chunks.save(job.sessionId, provider.id, { chunk, result });
    deps.usage.record({
      sessionId: job.sessionId,
      provider: provider.id,
      kind: 'stt',
      units: (chunk.endMs - chunk.startMs) / 1000,
      costEstimateUsd: result.costEstimateUsd ?? null,
      at: now(),
    });
  };
}

export type TranscriptionStatus = 'running' | 'done' | 'failed';

/** A session's transcription is done when every chunk job is done, failed if any job failed. */
export function transcriptionStatus(jobs: readonly Job[]): TranscriptionStatus {
  const chunkJobs = jobs.filter((job) => job.type === 'transcribe_chunk');
  if (chunkJobs.some((job) => job.status === 'failed')) {
    return 'failed';
  }
  return chunkJobs.every((job) => job.status === 'done') ? 'done' : 'running';
}
