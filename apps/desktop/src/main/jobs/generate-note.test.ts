import { describe, expect, it } from 'vitest';

import { NOTE_PROMPT_VERSION, ProviderError } from '@nova/core';
import type { LLMProvider, TranscribedChunk } from '@nova/core';
import { FakeLLM } from '@nova/core/testing';

import {
  createGenerateNoteHandler,
  generateJobFor,
  generationStatus,
  INVALID_NOTE_MESSAGE,
  NO_SPEECH_MESSAGE,
} from './generate-note';
import { PermanentJobError } from './job-runner';
import { QUICK_NOTE_OUTPUT } from '../__tests__/capture-harness';
import type { Job } from '../db/jobs-repo';
import { NoteDraftsRepo } from '../db/note-drafts-repo';
import { openDatabase } from '../db/open-database';
import { TranscriptChunksRepo } from '../db/transcript-chunks-repo';
import { UsageRepo } from '../db/usage-repo';

const CHUNK: TranscribedChunk = {
  chunk: { index: 0, startMs: 0, endMs: 30_000 },
  result: { segments: [{ startMs: 0, endMs: 30_000, text: 'Today we look at Fourier.' }] },
};

const job: Job = {
  ...generateJobFor('s1'),
  status: 'running',
  attempts: 0,
  lastError: null,
  nextRunAt: 1,
};

const setup = (llm: LLMProvider, withTranscript = true, vocabulary: readonly string[] = []) => {
  const db = openDatabase(':memory:');
  db.prepare("INSERT INTO sessions (id, state, started_at) VALUES ('s1', 'GENERATING', 1)").run();
  const chunks = new TranscriptChunksRepo(db);
  const drafts = new NoteDraftsRepo(db);
  const usage = new UsageRepo(db);
  if (withTranscript) chunks.save('s1', 'groq', CHUNK);
  const handler = createGenerateNoteHandler({
    chunks,
    drafts,
    usage,
    getProvider: () => llm,
    getVocabulary: () => vocabulary,
    now: () => 7,
  });
  const usageRows = () =>
    db.prepare('SELECT provider, kind, units, cost_estimate_usd FROM usage_log').all();
  return { handler, drafts, usageRows };
};

describe('generate_note job', () => {
  it('has a stable id per session', () => {
    expect(generateJobFor('s1')).toEqual({
      id: 's1:generate',
      type: 'generate_note',
      sessionId: 's1',
      payload: null,
    });
  });

  it('stores the draft with model, prompt version and time, and logs usage', async () => {
    const { handler, drafts, usageRows } = setup(new FakeLLM([{ output: QUICK_NOTE_OUTPUT }]));

    await handler(job);

    expect(drafts.get('s1')).toMatchObject({
      sessionId: 's1',
      aiModel: 'fake-llm-1',
      promptVersion: NOTE_PROMPT_VERSION,
      createdAt: 7,
      content: { mode: 'quick', title: 'Fourier basics', tags: ['math'] },
    });
    expect(usageRows()).toEqual([
      { provider: 'fake-llm', kind: 'llm', units: 150, cost_estimate_usd: 0 },
    ]);
  });

  it('gives the LLM the user vocabulary', async () => {
    const llm = new FakeLLM([{ output: QUICK_NOTE_OUTPUT }]);
    const { handler } = setup(llm, true, ['RAG']);
    await handler(job);
    expect(llm.calls[0]?.user).toContain('Vocabulary');
  });

  it('does not call the LLM again when a draft already exists', async () => {
    const llm = new FakeLLM([{ output: QUICK_NOTE_OUTPUT }]);
    const { handler } = setup(llm);
    await handler(job);
    await handler(job);
    expect(llm.calls).toHaveLength(1);
  });

  it('fails permanently without speech, before calling the LLM', async () => {
    const llm = new FakeLLM([]);
    const { handler } = setup(llm, false);
    const error: unknown = await handler(job).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PermanentJobError);
    expect((error as Error).message).toBe(NO_SPEECH_MESSAGE);
    expect(llm.calls).toHaveLength(0);
  });

  it('fails permanently after an invalid repair, and logs both billed calls', async () => {
    const { handler, drafts, usageRows } = setup(new FakeLLM([{ output: {} }, { output: {} }]));
    const error: unknown = await handler(job).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PermanentJobError);
    expect((error as Error).message).toBe(INVALID_NOTE_MESSAGE);
    expect(drafts.get('s1')).toBeUndefined();
    expect(usageRows()).toHaveLength(2);
  });

  it('passes provider errors through so the runner can retry them', async () => {
    const outage = new ProviderError('Gemini HTTP 503', 'gemini', true, 503);
    const { handler } = setup(new FakeLLM([outage]));
    await expect(handler(job)).rejects.toBe(outage);
  });
});

describe('generationStatus', () => {
  it('is done with a draft, failed when the job failed, otherwise running', () => {
    expect(generationStatus(true, { ...job, status: 'failed' })).toBe('done');
    expect(generationStatus(false, { ...job, status: 'failed' })).toBe('failed');
    expect(generationStatus(false, { ...job, status: 'pending' })).toBe('running');
    expect(generationStatus(false, undefined)).toBe('running');
  });
});
