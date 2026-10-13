import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { assembleTranscript, pcmToBytes, planChunks, ProviderError } from '@nova/core';
import { FakeSTT, speechPattern } from '@nova/core/testing';

import { analyzeSpool } from '../../../worker/spool-analyzer';
import { JobsRepo } from '../../db/jobs-repo';
import { openDatabase } from '../../db/open-database';
import { SessionsRepo } from '../../db/sessions-repo';
import { TranscriptChunksRepo } from '../../db/transcript-chunks-repo';
import { UsageRepo } from '../../db/usage-repo';
import { JobRunner } from '../../jobs/job-runner';
import {
  createTranscribeChunkHandler,
  transcribeJobFor,
  transcriptionStatus,
} from '../../jobs/transcribe-chunk';
import { log } from '../../log';

// TESTING.md §3.2: spool → analysis → chunk plan → job queue → FakeSTT → assembled transcript.

let dir: string;
let clock: number;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nova-transcription-'));
  clock = 1_000_000;
  vi.spyOn(log, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

async function setup(stt: FakeSTT) {
  let provider = stt;
  const db = openDatabase(':memory:');
  const sessions = new SessionsRepo(db);
  const jobs = new JobsRepo(db);
  const chunks = new TranscriptChunksRepo(db, () => clock);
  const usage = new UsageRepo(db);

  // A finished 75 s capture: speech, a pause, more speech.
  const spoolPath = join(dir, 's1.pcm');
  writeFileSync(
    spoolPath,
    pcmToBytes(speechPattern(['speech', 28_000], ['silence', 2000], ['speech', 45_000])),
  );
  sessions.create({ id: 's1', startedAt: clock, captureSource: 'fake', spoolPath });
  for (const type of ['started', 'stop', 'stopped'] as const) sessions.transition('s1', { type });

  const analysis = await analyzeSpool(spoolPath);
  sessions.recordAnalysis('s1', analysis);
  const plan = planChunks(analysis.durationMs, analysis.speech);
  jobs.enqueue(
    plan.map((chunk) => transcribeJobFor('s1', chunk)),
    clock,
  );

  const runner = new JobRunner({
    jobs,
    handlers: {
      transcribe_chunk: createTranscribeChunkHandler({
        sessions,
        chunks,
        usage,
        getProvider: () => provider,
        now: () => clock,
      }),
      generate_note: () => Promise.resolve(),
    },
    now: () => clock,
    random: () => 0,
  });

  /** Runs the queue until nothing is due, jumping the clock to each retry. */
  const drain = async () => {
    for (let i = 0; i < 50; i++) {
      await runner.tick();
      const pending = jobs.listBySession('s1').filter((j) => j.status === 'pending');
      if (pending.length === 0) return;
      clock = Math.min(...pending.map((j) => j.nextRunAt ?? clock));
    }
  };
  const useProvider = (next: FakeSTT) => {
    provider = next;
  };
  return { sessions, jobs, chunks, usage, plan, spoolPath, drain, useProvider };
}

describe('transcription pipeline', () => {
  it('transcribes every chunk and assembles one ordered transcript', async () => {
    const stt = new FakeSTT();
    const { jobs, chunks, usage, plan, drain } = await setup(stt);

    await drain();

    expect(plan.length).toBeGreaterThanOrEqual(3);
    expect(transcriptionStatus(jobs.listBySession('s1'))).toBe('done');
    const transcript = assembleTranscript(chunks.listBySession('s1'));
    expect(transcript.map((s) => s.text)).toEqual(plan.map((c) => `chunk ${String(c.index)}`));
    expect(transcript.map((s) => s.startMs)).toEqual(plan.map((c) => c.startMs));
    expect(usage.totalCostUsdSince(0)).toBe(0);
    expect(stt.calls).toHaveLength(plan.length);
  });

  it('retries when STT fails twice, then completes', async () => {
    const outage = new ProviderError('Service Unavailable', 'fake-stt', true, 503);
    const stt = new FakeSTT([outage, outage]);
    const { jobs, chunks, plan, drain } = await setup(stt);

    await drain();

    expect(transcriptionStatus(jobs.listBySession('s1'))).toBe('done');
    expect(chunks.listBySession('s1')).toHaveLength(plan.length);
    expect(stt.calls).toHaveLength(plan.length + 2);
  });

  it('keeps the job and the spool when STT always fails, and recovers on retry', async () => {
    const badKey = new ProviderError('Invalid API Key', 'fake-stt', false, 401);
    const stt = new FakeSTT(Array.from({ length: 10 }, () => badKey));
    const { sessions, jobs, chunks, plan, spoolPath, drain, useProvider } = await setup(stt);

    await drain();

    expect(transcriptionStatus(jobs.listBySession('s1'))).toBe('failed');
    expect(existsSync(spoolPath)).toBe(true);
    const failed = sessions.transition('s1', {
      type: 'transcribeFailed',
      error: 'Invalid API Key',
    });
    expect(failed).toMatchObject({ state: 'TRANSCRIBING', error: 'Invalid API Key' });

    // The user fixes the key and retries: only failed jobs run again.
    sessions.transition('s1', { type: 'retry' });
    jobs.retryFailed('s1', clock);
    const fixed = new FakeSTT();
    useProvider(fixed);
    await drain();

    expect(fixed.calls).toHaveLength(plan.length);

    expect(transcriptionStatus(jobs.listBySession('s1'))).toBe('done');
    expect(chunks.listBySession('s1')).toHaveLength(plan.length);
  });

  it('fails jobs after bounded retries when the spool file is missing', async () => {
    const stt = new FakeSTT();
    const { jobs, drain, spoolPath } = await setup(stt);
    rmSync(spoolPath);

    await drain();

    const states = jobs.listBySession('s1').map((j) => j.status);
    expect(states.every((s) => s === 'failed')).toBe(true);
    expect(stt.calls).toHaveLength(0);
  });
});
