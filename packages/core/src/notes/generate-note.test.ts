import { describe, expect, it } from 'vitest';

import { generateNote } from './generate-note';
import { NOTE_PROMPT_VERSION } from '../prompts/note-prompt';
import { InvalidOutputError, ProviderError } from '../providers/providers';
import type { LlmUsage } from '../providers/providers';
import { FAKE_LLM_USAGE, FakeLLM } from '../testing/fake-llm';

const SHORT = [{ startMs: 0, endMs: 30_000, text: 'Today we look at the Fourier transform.' }];
const LONG = [
  { startMs: 0, endMs: 100_000, text: 'Today we look at the Fourier transform.' },
  { startMs: 100_000, endMs: 200_000, text: 'Then the Nyquist rate.' },
];

const QUICK_OUTPUT = { title: 'Fourier', gist: 'An intro.', tags: ['Math'], language: 'en' };
const FULL_OUTPUT = {
  title: 'Fourier and Nyquist',
  summary: 'Two topics.',
  keyPoints: [
    { text: 'The "Fourier transform".', startSec: 0, endSec: 100 },
    { text: 'Something "unsaid".', startSec: 500, endSec: 600 },
  ],
  tags: ['signals'],
  language: 'en',
  uncertainTerms: [],
};

describe('generateNote', () => {
  it('writes a quick note for a short transcript in one call', async () => {
    const llm = new FakeLLM([{ output: QUICK_OUTPUT }]);
    const usage: LlmUsage[] = [];

    const note = await generateNote(llm, { segments: SHORT, onUsage: (u) => usage.push(u) });

    expect(note).toEqual({
      content: {
        mode: 'quick',
        title: 'Fourier',
        summary: 'An intro.',
        keyPoints: [],
        tags: ['math'],
        language: 'en',
        uncertainTerms: [],
      },
      aiModel: 'fake-llm-1',
      promptVersion: NOTE_PROMPT_VERSION,
    });
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]?.user).toContain('Write a quick note');
    expect(usage).toEqual([FAKE_LLM_USAGE]);
  });

  it('writes a full note for a long transcript and ground-checks its key points', async () => {
    const llm = new FakeLLM([{ output: FULL_OUTPUT }]);

    const note = await generateNote(llm, { segments: LONG });

    expect(note.content.mode).toBe('full');
    expect(note.content.keyPoints).toEqual([
      { text: 'The "Fourier transform".', startMs: 0, endMs: 100_000, flags: [] },
      {
        text: 'Something "unsaid".',
        startMs: 500_000,
        endMs: 600_000,
        flags: ['time-range-not-in-transcript', 'quoted-term-missing'],
      },
    ]);
  });

  it('honours an explicit mode', async () => {
    const llm = new FakeLLM([{ output: FULL_OUTPUT }]);
    const note = await generateNote(llm, { segments: SHORT, mode: 'full' });
    expect(note.content.mode).toBe('full');
  });

  it('makes one repair call that names the problems, and counts both calls', async () => {
    const llm = new FakeLLM([{ output: { title: 'Fourier' } }, { output: QUICK_OUTPUT }]);
    const usage: LlmUsage[] = [];

    const note = await generateNote(llm, { segments: SHORT, onUsage: (u) => usage.push(u) });

    expect(note.content.title).toBe('Fourier');
    expect(llm.calls).toHaveLength(2);
    expect(llm.calls[1]?.user).toContain('did not match the required format');
    expect(llm.calls[1]?.user).toContain('gist:');
    expect(usage).toHaveLength(2);
  });

  it('fails with InvalidOutputError when the repair is invalid too', async () => {
    const llm = new FakeLLM([{ output: {} }, { output: { title: 1 } }]);

    await expect(generateNote(llm, { segments: SHORT })).rejects.toBeInstanceOf(InvalidOutputError);
    expect(llm.calls).toHaveLength(2);
  });

  it('does not repair provider errors', async () => {
    const outage = new ProviderError('HTTP 503', 'fake-llm', true, 503);
    const llm = new FakeLLM([outage]);

    await expect(generateNote(llm, { segments: SHORT })).rejects.toBe(outage);
    expect(llm.calls).toHaveLength(1);
  });

  it('passes the cancel signal to the provider', async () => {
    const llm = new FakeLLM([{ output: QUICK_OUTPUT }]);
    await expect(generateNote(llm, { segments: SHORT, signal: { aborted: true } })).rejects.toThrow(
      'Aborted',
    );
  });
});
