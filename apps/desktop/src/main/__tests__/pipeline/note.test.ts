import { existsSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeLLM, speechPattern } from '@nova/core/testing';

import { INVALID_NOTE_MESSAGE } from '../../jobs/generate-note';
import { log } from '../../log';
import { createCaptureHarness, settle } from '../capture-harness';

// TESTING.md §3.2: capture → spool → chunks → FakeSTT → transcript → FakeLLM → review → saved note.

type Harness = ReturnType<typeof createCaptureHarness>;
let h: Harness;

beforeEach(() => {
  vi.spyOn(log, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  h.cleanup();
  vi.restoreAllMocks();
});

/** 30 s of audio, played five times: 140 s of speech, enough for a Full Note. */
const HALF_MINUTE = speechPattern(['speech', 28_000], ['silence', 2000]);
const LONG_LECTURE = Array.from({ length: 5 }, () => HALF_MINUTE);

const FULL_OUTPUT = {
  title: 'Signals lecture',
  summary: 'Six chunks about signals.',
  keyPoints: [
    { text: 'Starts with "chunk 0".', startSec: 0, endSec: 20 },
    { text: 'Claims a "wavelet" was covered.', startSec: 400, endSec: 420 },
  ],
  tags: ['Signals'],
  language: 'en',
  uncertainTerms: [],
};

/**
 * Plays `parts` with a pause between them. FakeAudioSource delivers frames instantly, so the
 * spool writer (which buffers at most 60 s, like a stalled disk) needs time to flush.
 */
async function captureAndProcess(parts: readonly Int16Array[]) {
  const id = await h.orchestrator.start();
  for (const part of parts) {
    await h.captureHost.play(part);
    await settle();
  }
  await h.orchestrator.stop();
  await h.drainJobs();
  return id;
}

describe('note pipeline', () => {
  it('turns a long capture into a full note that is saved and searchable', async () => {
    const llm = new FakeLLM([{ output: FULL_OUTPUT }]);
    h = createCaptureHarness({ llm });

    const id = await captureAndProcess(LONG_LECTURE);

    expect(h.sessions.get(id)?.state).toBe('REVIEW');
    expect(llm.calls[0]?.user).toContain('Write a full note');
    expect(llm.calls[0]?.user).toContain('] chunk 0');
    const draft = h.orchestrator.draft(id);
    expect(draft?.content.keyPoints.map((p) => p.flags)).toEqual([
      [],
      ['time-range-not-in-transcript', 'quoted-term-missing'],
    ]);

    const content = draft?.content;
    const noteId = h.orchestrator.save(id, {
      title: content?.title ?? '',
      summary: content?.summary ?? '',
      keyPoints:
        content?.keyPoints
          .slice(0, 1)
          .map(({ text, startMs, endMs }) => ({ text, startMs, endMs })) ?? [],
      tags: content?.tags ?? [],
    });

    expect(h.sessions.get(id)?.state).toBe('SAVED');
    expect(h.notes.get(noteId)?.keyPoints).toHaveLength(1);
    const hits = h.db
      .prepare("SELECT note_id FROM notes_fts WHERE notes_fts MATCH 'signal'")
      .all()
      .map((r) => r['note_id']);
    expect(hits).toEqual([noteId]);
  });

  it('shows a visible failure with the transcript kept when the LLM output stays invalid', async () => {
    const llm = new FakeLLM([{ output: { title: 'x' } }, { output: 'not an object' }]);
    h = createCaptureHarness({ llm });

    const id = await captureAndProcess(LONG_LECTURE);

    expect(llm.calls).toHaveLength(2);
    expect(h.sessions.get(id)).toMatchObject({ state: 'GENERATING', error: INVALID_NOTE_MESSAGE });
    expect(h.orchestrator.transcript(id).length).toBeGreaterThan(0);
    expect(existsSync(h.sessions.get(id)?.spoolPath ?? '')).toBe(true);
  });
});
