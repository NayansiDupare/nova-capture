import { describe, expect, it } from 'vitest';

import { assembleTranscript } from './assembler';
import type { TranscribedChunk } from './assembler';

const chunk = (
  index: number,
  startS: number,
  endS: number,
  segments: [startS: number, endS: number, text: string][],
): TranscribedChunk => ({
  chunk: { index, startMs: startS * 1000, endMs: endS * 1000 },
  result: {
    segments: segments.map(([s, e, text]) => ({ startMs: s * 1000, endMs: e * 1000, text })),
  },
});

const texts = (chunks: TranscribedChunk[]) => assembleTranscript(chunks).map((s) => s.text);

describe('assembleTranscript', () => {
  it('offsets segment times by the chunk start', () => {
    const result = assembleTranscript([
      chunk(0, 0, 30, [[0, 5, 'Hello class.']]),
      chunk(1, 40, 70, [[2, 6, 'Next topic.']]),
    ]);
    expect(result).toEqual([
      { startMs: 0, endMs: 5000, text: 'Hello class.' },
      { startMs: 42_000, endMs: 46_000, text: 'Next topic.' },
    ]);
  });

  it('keeps everything when chunks do not overlap', () => {
    expect(
      texts([
        chunk(0, 0, 30, [[0, 30, 'one two three']]),
        chunk(1, 30, 60, [[0, 30, 'one two three']]),
      ]),
    ).toEqual(['one two three', 'one two three']);
  });

  it('removes words repeated exactly in the overlap', () => {
    const result = assembleTranscript([
      chunk(0, 0, 30, [[20, 30, 'the Fourier transform maps signals']]),
      chunk(1, 28.5, 58.5, [[0, 6, 'maps signals into frequencies.']]),
    ]);
    expect(result.map((s) => s.text)).toEqual([
      'the Fourier transform maps signals',
      'into frequencies.',
    ]);
    // The trimmed segment no longer starts inside the overlap.
    expect(result[1]?.startMs).toBe(30_000);
  });

  it('ignores case and punctuation when matching', () => {
    expect(
      texts([
        chunk(0, 0, 30, [[25, 30, 'We call this, the Gradient.']]),
        chunk(1, 28.5, 58.5, [[0, 5, 'the gradient descent step']]),
      ]),
    ).toEqual(['We call this, the Gradient.', 'descent step']);
  });

  it('skips a clipped first word before the repeat', () => {
    expect(
      texts([
        chunk(0, 0, 30, [[25, 30, 'learning rate matters a lot']]),
        chunk(1, 28.5, 58.5, [[0, 5, 'ers a lot here']]),
      ]),
    ).toEqual(['learning rate matters a lot', 'here']);
  });

  it('removes a repeated phrase whole', () => {
    expect(
      texts([
        chunk(0, 0, 30, [[25, 30, 'thank you thank you']]),
        chunk(1, 28.5, 58.5, [[0, 5, 'thank you thank you so much']]),
      ]),
    ).toEqual(['thank you thank you', 'so much']);
  });

  it('removes duplicates spanning several segments and drops emptied ones', () => {
    expect(
      texts([
        chunk(0, 0, 30, [[27, 30, 'and then we integrate by parts']]),
        chunk(1, 28.5, 58.5, [
          [0, 1, 'integrate by'],
          [1, 2, 'parts.'],
          [2, 6, 'Now the boundary term.'],
        ]),
      ]),
    ).toEqual(['and then we integrate by parts', 'Now the boundary term.']);
  });

  it('falls back to timing when the overlap text does not line up', () => {
    expect(
      texts([
        chunk(0, 0, 30, [[26, 30, 'completely different words']]),
        chunk(1, 28, 58, [
          [0, 1, 'mumble'],
          [1.5, 5, 'new sentence here'],
        ]),
      ]),
    ).toEqual(['completely different words', 'new sentence here']);
  });

  it('drops empty segments and sorts chunks by start time', () => {
    expect(
      texts([
        chunk(1, 40, 60, [[0, 2, 'second']]),
        chunk(0, 0, 30, [
          [0, 1, '  '],
          [1, 2, 'first'],
        ]),
      ]),
    ).toEqual(['first', 'second']);
  });

  it('returns an empty transcript for no chunks', () => {
    expect(assembleTranscript([])).toEqual([]);
  });
});
