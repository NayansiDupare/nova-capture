import { assembleTranscript, generateNote, InvalidOutputError } from '@nova/core';
import type { LLMProvider } from '@nova/core';

import { PermanentJobError } from './job-runner';
import type { JobHandler } from './job-runner';
import type { Job } from '../db/jobs-repo';
import type { NoteDraftsRepo } from '../db/note-drafts-repo';
import type { TranscriptChunksRepo } from '../db/transcript-chunks-repo';
import type { UsageRepo } from '../db/usage-repo';

export const NO_SPEECH_MESSAGE =
  'No speech was found in this recording, so there is nothing to write a note from.';
export const INVALID_NOTE_MESSAGE =
  "The AI note didn't come back in the expected format. Your transcript is safe. Retry to try again.";

/** One generation job per session; the stable id makes enqueueing it twice harmless. */
export const generateJobId = (sessionId: string) => `${sessionId}:generate`;

export function generateJobFor(sessionId: string) {
  return {
    id: generateJobId(sessionId),
    type: 'generate_note' as const,
    sessionId,
    payload: null,
  };
}

/**
 * Writes the note draft for a session (ARCHITECTURE.md §9): assembles the transcript, calls
 * the LLM with one repair attempt, ground-checks the key points and stores the draft. Usage is
 * logged per call, including invalid answers, because they are billed too.
 */
export function createGenerateNoteHandler(deps: {
  chunks: TranscriptChunksRepo;
  drafts: NoteDraftsRepo;
  usage: UsageRepo;
  getProvider: () => LLMProvider;
  getVocabulary?: () => readonly string[];
  now?: () => number;
}): JobHandler {
  const now = deps.now ?? Date.now;
  return async (job: Job) => {
    if (deps.drafts.get(job.sessionId)) {
      // Generated before a crash or restart: never pay for the same note twice.
      return;
    }
    const segments = assembleTranscript(deps.chunks.listBySession(job.sessionId));
    if (segments.length === 0) {
      throw new PermanentJobError(NO_SPEECH_MESSAGE);
    }

    const provider = deps.getProvider();
    try {
      const note = await generateNote(provider, {
        segments,
        vocabulary: deps.getVocabulary?.() ?? [],
        onUsage: (usage) => {
          deps.usage.record({
            sessionId: job.sessionId,
            provider: provider.id,
            kind: 'llm',
            units: usage.inputTokens + usage.outputTokens,
            costEstimateUsd: usage.costEstimateUsd ?? null,
            at: now(),
          });
        },
      });
      deps.drafts.save({ sessionId: job.sessionId, ...note, createdAt: now() });
    } catch (error) {
      // §15: after the repair call, show the transcript with a retry button; no automatic retries.
      if (error instanceof InvalidOutputError) throw new PermanentJobError(INVALID_NOTE_MESSAGE);
      throw error;
    }
  };
}

export type GenerationStatus = 'running' | 'done' | 'failed';

/** Generation is done once the draft exists, failed when its job failed. */
export function generationStatus(hasDraft: boolean, job: Job | undefined): GenerationStatus {
  if (hasDraft) return 'done';
  return job?.status === 'failed' ? 'failed' : 'running';
}
