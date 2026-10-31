import { describe, expect, it } from 'vitest';

import { groundKeyPoints, quotedTerms } from './ground-check';

const TRANSCRIPT = [
  { startMs: 0, endMs: 4000, text: 'Today we look at the Fourier transform.' },
  { startMs: 4000, endMs: 9000, text: "It maps a signal from time to frequency, that's all." },
  { startMs: 60_000, endMs: 64_000, text: 'Then the Nyquist rate.' },
];

const point = (text: string, startMs: number, endMs: number) => ({ text, startMs, endMs });

describe('groundKeyPoints', () => {
  it('passes a point whose range overlaps the transcript and whose quotes appear in it', () => {
    const [result] = groundKeyPoints(
      [point('The "Fourier transform" maps “time to frequency”.', 1000, 8000)],
      TRANSCRIPT,
    );
    expect(result?.flags).toEqual([]);
  });

  it('flags a time range with no transcript segment, allowing one second of slack', () => {
    const results = groundKeyPoints(
      [point('Gap', 20_000, 30_000), point('Near', 9900, 12_000)],
      TRANSCRIPT,
    );
    expect(results.map((r) => r.flags)).toEqual([['time-range-not-in-transcript'], []]);
  });

  it('flags a quoted term the transcript never says', () => {
    const [result] = groundKeyPoints([point('Uses the `Laplace transform`.', 0, 4000)], TRANSCRIPT);
    expect(result?.flags).toEqual(['quoted-term-missing']);
  });

  it('matches quoted terms by whole words, ignoring case and punctuation', () => {
    const results = groundKeyPoints(
      [point('"NYQUIST rate!"', 60_000, 61_000), point('"art"', 0, 4000)],
      TRANSCRIPT,
    );
    // "art" only appears inside "start"/"part" style words, never on its own.
    expect(results.map((r) => r.flags)).toEqual([[], ['quoted-term-missing']]);
  });

  it('trusts quoted vocabulary terms that correct a misheard word', () => {
    const transcript = [{ startMs: 0, endMs: 4000, text: 'Everything related to RAC.' }];
    const points = [point('Covers "RAG" from scratch.', 0, 4000)];
    expect(groundKeyPoints(points, transcript)[0]?.flags).toEqual(['quoted-term-missing']);
    expect(groundKeyPoints(points, transcript, ['rag'])[0]?.flags).toEqual([]);
  });

  it('flags every point when the transcript is empty', () => {
    const [result] = groundKeyPoints([point('"x"', 0, 1000)], []);
    expect(result?.flags).toEqual(['time-range-not-in-transcript', 'quoted-term-missing']);
  });
});

describe('quotedTerms', () => {
  it('reads double quotes, curly quotes and backticks, but not apostrophes', () => {
    expect(quotedTerms(`It's the "FFT", “Big O” and \`O(n)\`; don't stop`)).toEqual([
      'fft',
      'big o',
      'o n',
    ]);
  });

  it('drops quotes that contain only punctuation', () => {
    expect(quotedTerms('Say "..." now')).toEqual([]);
  });
});
