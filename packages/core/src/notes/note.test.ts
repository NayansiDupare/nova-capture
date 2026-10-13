import { describe, expect, it } from 'vitest';

import {
  chooseNoteMode,
  FullNoteOutputSchema,
  MAX_TAGS,
  NoteContentSchema,
  NoteEditsSchema,
  normalizeTags,
  QUICK_MAX_SPEECH_MS,
  QuickNoteOutputSchema,
  speechDurationMs,
  toNoteContent,
} from './note';

const seg = (startMs: number, endMs: number, text = 'x') => ({ startMs, endMs, text });

const FULL = {
  title: '  Fourier transform  ',
  summary: 'Maps time to frequency.',
  keyPoints: [{ text: 'Signals decompose into sines.', startSec: 12.34, endSec: 15 }],
  tags: ['Signal Processing', 'math'],
  language: 'en',
  uncertainTerms: ['  Nyquist ', 'Nyquist', ''],
};

describe('note mode', () => {
  it('sums speech from segment ranges, ignoring inverted ones', () => {
    expect(speechDurationMs([seg(0, 1000), seg(2000, 2500), seg(5000, 4000)])).toBe(1500);
  });

  it('uses Quick Save below two minutes of speech and Full Note from there', () => {
    expect(chooseNoteMode([])).toBe('quick');
    expect(chooseNoteMode([seg(0, QUICK_MAX_SPEECH_MS - 1)])).toBe('quick');
    expect(chooseNoteMode([seg(0, QUICK_MAX_SPEECH_MS)])).toBe('full');
  });
});

describe('LLM output schemas', () => {
  it('accept a valid full and quick note', () => {
    expect(FullNoteOutputSchema.safeParse(FULL).success).toBe(true);
    expect(
      QuickNoteOutputSchema.safeParse({ title: 't', gist: 'g', tags: [], language: 'de' }).success,
    ).toBe(true);
  });

  it('reject a full note without key points, a blank title or a negative time', () => {
    expect(FullNoteOutputSchema.safeParse({ ...FULL, keyPoints: [] }).success).toBe(false);
    expect(FullNoteOutputSchema.safeParse({ ...FULL, title: '   ' }).success).toBe(false);
    const negative = { ...FULL, keyPoints: [{ text: 'a', startSec: -1, endSec: 2 }] };
    expect(FullNoteOutputSchema.safeParse(negative).success).toBe(false);
  });
});

describe('normalizeTags', () => {
  it('lowercases, hyphenates, strips symbols and de-duplicates', () => {
    expect(
      normalizeTags(['Machine Learning', 'machine-learning', ' C++ ', '#ai', '--', 'Grüße']),
    ).toEqual(['machine-learning', 'c', 'ai', 'grüße']);
  });

  it(`keeps at most ${String(MAX_TAGS)} tags`, () => {
    expect(normalizeTags(Array.from({ length: 20 }, (_, i) => `t${String(i)}`))).toHaveLength(
      MAX_TAGS,
    );
  });
});

describe('toNoteContent', () => {
  it('converts a full note to milliseconds and cleans tags and uncertain terms', () => {
    const content = toNoteContent({ mode: 'full', note: FullNoteOutputSchema.parse(FULL) });
    expect(content).toEqual({
      mode: 'full',
      title: 'Fourier transform',
      summary: 'Maps time to frequency.',
      keyPoints: [{ text: 'Signals decompose into sines.', startMs: 12_340, endMs: 15_000 }],
      tags: ['signal-processing', 'math'],
      language: 'en',
      uncertainTerms: ['Nyquist'],
    });
  });

  it('swaps an inverted key point range', () => {
    const note = { ...FULL, keyPoints: [{ text: 'a', startSec: 9, endSec: 3 }] };
    const content = toNoteContent({ mode: 'full', note });
    expect(content.keyPoints[0]).toMatchObject({ startMs: 3000, endMs: 9000 });
  });

  it('stores a quick note gist as the summary, with no key points', () => {
    const content = toNoteContent({
      mode: 'quick',
      note: { title: 'Short', gist: 'One line.', tags: ['x'], language: 'en' },
    });
    expect(content).toMatchObject({ mode: 'quick', summary: 'One line.', keyPoints: [] });
    expect(NoteContentSchema.safeParse(content).success).toBe(true);
  });
});

describe('NoteEditsSchema', () => {
  const edits = { title: 'T', summary: 'S', keyPoints: [], tags: [] };

  it('accepts edits and trims text', () => {
    expect(NoteEditsSchema.parse({ ...edits, title: '  T  ' }).title).toBe('T');
  });

  it('rejects blank titles, unknown fields and fractional times', () => {
    expect(NoteEditsSchema.safeParse({ ...edits, title: ' ' }).success).toBe(false);
    expect(NoteEditsSchema.safeParse({ ...edits, mode: 'full' }).success).toBe(false);
    const fractional = { ...edits, keyPoints: [{ text: 'a', startMs: 0.5, endMs: 1 }] };
    expect(NoteEditsSchema.safeParse(fractional).success).toBe(false);
  });
});
