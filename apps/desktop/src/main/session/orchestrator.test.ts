import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import { pcmToBytes, ProviderError } from '@nova/core';
import type { NoteDraft, TranscribedChunk } from '@nova/core';
import { FakeLLM, FakeSTT, speechPattern } from '@nova/core/testing';

import { createCaptureHarness, quickNoteLlm, settle, waitFor } from '../__tests__/capture-harness';
import { generateJobId, INVALID_NOTE_MESSAGE, NO_SPEECH_MESSAGE } from '../jobs/generate-note';
import { log } from '../log';
import { CLOSED_DURING_CAPTURE } from './orchestrator';

type Harness = ReturnType<typeof createCaptureHarness>;
let h: Harness;
let logError: MockInstance<typeof log.error>;

beforeEach(() => {
  vi.spyOn(log, 'warn').mockImplementation(() => undefined);
  logError = vi.spyOn(log, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  h.cleanup();
  vi.restoreAllMocks();
});

/** Records `pcm` and stops, leaving the session in TRANSCRIBING with jobs queued. */
async function record(pcm: Int16Array) {
  const id = await h.orchestrator.start();
  await h.captureHost.play(pcm);
  await h.orchestrator.stop();
  return id;
}

const CHUNK: TranscribedChunk = {
  chunk: { index: 0, startMs: 0, endMs: 28_000 },
  result: { segments: [{ startMs: 0, endMs: 28_000, text: 'Fourier.' }] },
};

const DRAFT: NoteDraft = {
  sessionId: 's1',
  content: {
    mode: 'quick',
    title: 'Saved before crash',
    summary: 'Gist.',
    keyPoints: [],
    tags: [],
    language: 'en',
    uncertainTerms: [],
  },
  aiModel: 'fake-llm-1',
  promptVersion: 'note-v1',
  createdAt: 1,
};

const LECTURE = speechPattern(['speech', 28_000], ['silence', 2000], ['speech', 20_000]);

describe('SessionOrchestrator', () => {
  it('records, transcribes and writes a note draft for review', async () => {
    h = createCaptureHarness();
    const id = await record(LECTURE);

    expect(h.sessions.get(id)).toMatchObject({ state: 'TRANSCRIBING', durationMs: 50_000 });
    await h.drainJobs();

    expect(h.states()).toEqual([
      'STARTING',
      'LISTENING',
      'STOPPING',
      'TRANSCRIBING',
      'GENERATING',
      'REVIEW',
    ]);
    expect(h.orchestrator.draft(id)?.content).toMatchObject({
      mode: 'quick',
      title: 'Fourier basics',
    });
    expect(h.orchestrator.transcript(id).map((s) => s.text)).toEqual(['chunk 0', 'chunk 1']);
    expect(h.sessions.get(id)?.speechRatio).toBeCloseTo(48 / 50, 2);
    expect(h.captureHost.stops).toBe(1);
  });

  it('returns the running session instead of starting a second one', async () => {
    h = createCaptureHarness();
    const first = await h.orchestrator.start();
    expect(await h.orchestrator.start()).toBe(first);
    expect(h.sessions.listUnfinished()).toHaveLength(1);
  });

  it('does nothing on stop, pause or resume without a capture', async () => {
    h = createCaptureHarness();
    await h.orchestrator.stop();
    h.orchestrator.pause();
    h.orchestrator.resume();
    expect(h.events).toEqual([]);
  });

  it('fails the session when the capture host cannot start, and releases the worker', async () => {
    h = createCaptureHarness();
    h.captureHost.failNextStart = new Error('System audio was not shared');

    const id = await h.orchestrator.start();

    expect(h.sessions.get(id)).toMatchObject({
      state: 'FAILED',
      error: 'System audio was not shared',
    });
    expect(h.orchestrator.activeSessionId).toBeUndefined();
    expect(h.processes[0]?.worker.activeSessionId).toBeUndefined();
    // A new capture can start right away.
    expect(await h.orchestrator.start()).toBe('s2');
  });

  it('does not spool audio while paused', async () => {
    h = createCaptureHarness();
    const id = await h.orchestrator.start();
    await h.captureHost.play(speechPattern(['speech', 5000]));
    h.orchestrator.pause();
    await h.captureHost.play(speechPattern(['speech', 5000]));
    h.orchestrator.resume();
    await h.captureHost.play(speechPattern(['speech', 5000]));
    await h.orchestrator.stop();

    expect(h.states()).toContain('PAUSED');
    expect(h.sessions.get(id)?.durationMs).toBe(10_000);
  });

  it('keeps and transcribes the audio when the device is lost mid-capture', async () => {
    h = createCaptureHarness();
    const id = await h.orchestrator.start();
    await h.captureHost.play(LECTURE);

    await h.orchestrator.captureLost(id, 'The system audio stream ended');
    await h.drainJobs();

    expect(h.events.find((e) => e.state === 'STOPPING')?.error).toBe(
      'The system audio stream ended',
    );
    expect(h.sessions.get(id)).toMatchObject({ state: 'REVIEW', durationMs: 50_000 });
  });

  it('keeps flushed audio when the worker crashes mid-capture', async () => {
    h = createCaptureHarness({ flushIntervalMs: 5 });
    const id = await h.orchestrator.start();
    await h.captureHost.play(speechPattern(['speech', 8000]));
    await settle(); // let the worker flush to disk

    h.processes[0]?.crash();
    // The respawned worker analyzes the spool; wait for the chunk jobs to be queued.
    await waitFor(() => h.sessions.get(id)?.durationMs !== null);
    await h.drainJobs();

    expect(h.events.find((e) => e.state === 'STOPPING')?.error).toMatch(/Audio worker stopped/);
    // The worker is respawned for analysis, and the 8 s already on disk are transcribed.
    expect(h.processes).toHaveLength(2);
    expect(h.sessions.get(id)).toMatchObject({ state: 'REVIEW', durationMs: 8000 });
  });

  it('applies a capture loss reported during start-up once the session is listening', async () => {
    h = createCaptureHarness();
    const starting = h.orchestrator.start();
    // The worker reports a problem before the capture host has finished starting.
    await h.orchestrator.captureLost('s1', 'The system audio stream ended');
    await starting;
    await waitFor(() => h.sessions.get('s1')?.state === 'GENERATING');

    expect(h.states()).toEqual(['STARTING', 'LISTENING', 'STOPPING', 'TRANSCRIBING', 'GENERATING']);
    expect(h.events.find((e) => e.state === 'STOPPING')?.error).toBe(
      'The system audio stream ended',
    );
    expect(h.orchestrator.activeSessionId).toBeUndefined();
  });

  it('logs instead of rejecting when a capture loss cannot be applied', async () => {
    h = createCaptureHarness();
    const id = await h.orchestrator.start();
    // Something else already ended the session behind the orchestrator's back.
    h.db.prepare("UPDATE sessions SET state = 'DISCARDED' WHERE id = ?").run(id);

    await expect(h.orchestrator.captureLost(id, 'device lost')).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalledWith('handling capture loss failed', expect.anything());
  });

  it('skips STT without speech, then stops before the LLM with a plain message', async () => {
    const llm = quickNoteLlm();
    h = createCaptureHarness({ llm });
    const id = await record(speechPattern(['silence', 10_000]));
    expect(h.sessions.get(id)?.state).toBe('GENERATING');
    expect(h.jobs.listBySession(id).map((j) => j.type)).toEqual(['generate_note']);
    expect(h.orchestrator.transcript(id)).toEqual([]);

    await h.drainJobs();

    expect(h.sessions.get(id)).toMatchObject({ state: 'GENERATING', error: NO_SPEECH_MESSAGE });
    expect(llm.calls).toHaveLength(0);
  });

  it('stays retryable when STT fails permanently, and finishes after retry', async () => {
    const badKey = new ProviderError('Invalid API Key', 'fake-stt', false, 401);
    h = createCaptureHarness({ stt: new FakeSTT([badKey, badKey]) });
    const id = await record(LECTURE);
    await h.drainJobs();

    expect(h.sessions.get(id)).toMatchObject({ state: 'TRANSCRIBING', error: 'Invalid API Key' });
    const spool = h.sessions.get(id)?.spoolPath ?? '';
    expect(existsSync(spool)).toBe(true);

    await h.orchestrator.retry(id);
    await h.drainJobs();

    expect(h.sessions.get(id)).toMatchObject({ state: 'REVIEW', error: null });
    expect(existsSync(spool)).toBe(true);
  });

  it('discards a session and drops its queued jobs', async () => {
    h = createCaptureHarness();
    const id = await record(LECTURE);
    expect(h.jobs.listBySession(id).length).toBeGreaterThan(0);

    await h.orchestrator.discard(id);

    expect(h.sessions.get(id)?.state).toBe('DISCARDED');
    expect(h.jobs.listBySession(id)).toEqual([]);
  });

  it('discards a running capture and stops the device', async () => {
    h = createCaptureHarness();
    const id = await h.orchestrator.start();
    await h.orchestrator.discard(id);
    expect(h.sessions.get(id)?.state).toBe('DISCARDED');
    expect(h.orchestrator.activeSessionId).toBeUndefined();
    expect(h.captureHost.stops).toBe(1);
  });

  it('cancels instead of stopping when stop arrives during start-up', async () => {
    h = createCaptureHarness();
    const starting = h.orchestrator.start();
    await h.orchestrator.stop();
    const id = await starting;
    expect(h.sessions.get(id)?.state).toBe('DISCARDED');
    expect(h.captureHost.stops).toBeGreaterThanOrEqual(1);
  });

  describe('recovery at launch', () => {
    const seed = (state: string, id = 's1', withSpool = true) => {
      const spoolPath = join(h.dir, `${id}.pcm`);
      if (withSpool) writeFileSync(spoolPath, pcmToBytes(LECTURE));
      h.db
        .prepare('INSERT INTO sessions (id, state, started_at, spool_path) VALUES (?, ?, 1, ?)')
        .run(id, state, spoolPath);
    };

    it.each(['LISTENING', 'PAUSED'])('finishes a capture interrupted in %s', async (state) => {
      h = createCaptureHarness();
      seed(state);

      await h.orchestrator.recover();
      await h.drainJobs();

      expect(h.events.find((e) => e.state === 'STOPPING')?.error).toBe(CLOSED_DURING_CAPTURE);
      expect(h.sessions.get('s1')).toMatchObject({ state: 'REVIEW', durationMs: 50_000 });
    });

    it('finishes a session interrupted while STOPPING', async () => {
      h = createCaptureHarness();
      seed('STOPPING');
      await h.orchestrator.recover();
      await h.drainJobs();
      expect(h.sessions.get('s1')?.state).toBe('REVIEW');
    });

    it('discards a session that never got past STARTING', async () => {
      h = createCaptureHarness();
      seed('STARTING', 's1', false);
      await h.orchestrator.recover();
      expect(h.sessions.get('s1')?.state).toBe('DISCARDED');
    });

    it('plans a TRANSCRIBING session that crashed before its jobs were queued', async () => {
      h = createCaptureHarness();
      seed('TRANSCRIBING');
      await h.orchestrator.recover();
      expect(h.jobs.listBySession('s1').length).toBeGreaterThan(0);
      await h.drainJobs();
      expect(h.sessions.get('s1')?.state).toBe('REVIEW');
    });

    it('requeues jobs that were running when the app closed', async () => {
      h = createCaptureHarness();
      seed('TRANSCRIBING');
      h.jobs.enqueue(
        [
          {
            id: 'j1',
            type: 'transcribe_chunk',
            sessionId: 's1',
            payload: { chunkIndex: 0, startMs: 0, endMs: 28_200 },
          },
        ],
        1,
      );
      h.jobs.claimDue(1, 1);

      await h.orchestrator.recover();

      expect(h.jobs.get('j1')?.status).toBe('pending');
    });

    it('leaves a failed TRANSCRIBING session for the user to retry', async () => {
      h = createCaptureHarness();
      seed('TRANSCRIBING');
      h.db.prepare("UPDATE sessions SET error = 'Invalid API Key' WHERE id = 's1'").run();
      await h.orchestrator.recover();
      expect(h.jobs.listBySession('s1')).toEqual([]);
      expect(h.events).toEqual([]);
    });

    it('marks transcription failed when the spool is missing, and re-plans on retry', async () => {
      h = createCaptureHarness();
      seed('STOPPING', 's1', false);
      await h.orchestrator.recover();
      expect(h.sessions.get('s1')?.state).toBe('TRANSCRIBING');
      expect(h.sessions.get('s1')?.error).toMatch(/Could not read the audio/);

      // The file becomes readable again (for example a drive reconnected).
      writeFileSync(join(h.dir, 's1.pcm'), pcmToBytes(LECTURE));
      await h.orchestrator.retry('s1');
      await h.drainJobs();

      expect(h.sessions.get('s1')).toMatchObject({ state: 'REVIEW', error: null });
    });

    it('queues the note job for a GENERATING session that crashed before queueing it', async () => {
      h = createCaptureHarness();
      seed('GENERATING');
      h.chunks.save('s1', 'fake-stt', CHUNK);

      await h.orchestrator.recover();
      expect(h.jobs.get(generateJobId('s1'))?.status).toBe('pending');
      await h.drainJobs();

      expect(h.sessions.get('s1')?.state).toBe('REVIEW');
    });

    it('moves a GENERATING session whose draft was saved before the crash to REVIEW', async () => {
      const llm = quickNoteLlm();
      h = createCaptureHarness({ llm });
      seed('GENERATING');
      h.drafts.save(DRAFT);

      await h.orchestrator.recover();
      await h.drainJobs();

      expect(h.sessions.get('s1')?.state).toBe('REVIEW');
      expect(llm.calls).toHaveLength(0);
    });

    it('leaves a failed GENERATING session and a REVIEW session alone', async () => {
      h = createCaptureHarness();
      seed('GENERATING');
      h.db.prepare("UPDATE sessions SET error = 'Bad key' WHERE id = 's1'").run();
      seed('REVIEW', 's2');
      await h.orchestrator.recover();
      expect(h.jobs.listBySession('s1')).toEqual([]);
      expect(h.jobs.listBySession('s2')).toEqual([]);
      expect(h.events).toEqual([]);
    });
  });

  describe('notes', () => {
    it('keeps the transcript when the LLM fails, and writes the note on retry', async () => {
      const badKey = new ProviderError('API key not valid', 'fake-llm', false, 400);
      h = createCaptureHarness({ llm: new FakeLLM([badKey]) });
      const id = await record(LECTURE);
      await h.drainJobs();

      expect(h.sessions.get(id)).toMatchObject({ state: 'GENERATING', error: 'API key not valid' });
      expect(h.orchestrator.transcript(id)).toHaveLength(2);

      h.useLlm(quickNoteLlm());
      await h.orchestrator.retry(id);
      await h.drainJobs();

      expect(h.sessions.get(id)).toMatchObject({ state: 'REVIEW', error: null });
    });

    it('fails visibly after one repair call, without automatic retries', async () => {
      const llm = new FakeLLM([{ output: {} }, { output: {} }, { output: {} }]);
      h = createCaptureHarness({ llm });
      const id = await record(LECTURE);
      await h.drainJobs();

      expect(h.sessions.get(id)).toMatchObject({
        state: 'GENERATING',
        error: INVALID_NOTE_MESSAGE,
      });
      expect(llm.calls).toHaveLength(2);
    });

    it('saves the reviewed note and announces SAVED', async () => {
      h = createCaptureHarness();
      const id = await record(LECTURE);
      await h.drainJobs();

      const noteId = h.orchestrator.save(id, {
        title: 'My title',
        summary: 'Edited gist.',
        keyPoints: [],
        tags: ['Signals', 'signals'],
      });

      expect(h.states().at(-1)).toBe('SAVED');
      expect(h.notes.get(noteId)).toMatchObject({
        title: 'My title',
        summary: 'Edited gist.',
        tags: ['signals'],
        mode: 'quick',
        aiModel: 'fake-llm-1',
        sttProvider: 'fake-stt',
      });
      expect(h.orchestrator.draft(id)).toBeNull();
      // The spool is kept; cleaning it up after save is a separate, later step.
      expect(existsSync(h.sessions.get(id)?.spoolPath ?? '')).toBe(true);
    });
  });
});
