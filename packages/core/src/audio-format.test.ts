import { describe, expect, it } from 'vitest';

import { AUDIO_FORMAT, samplesForDurationMs } from './audio-format';

describe('AUDIO_FORMAT', () => {
  it('is 16 kHz mono signed 16-bit little-endian PCM', () => {
    expect(AUDIO_FORMAT).toEqual({ sampleRate: 16000, channels: 1, encoding: 'pcm_s16le' });
  });
});

describe('samplesForDurationMs', () => {
  it('returns 1600 samples for a 100 ms frame', () => {
    expect(samplesForDurationMs(100)).toBe(1600);
  });

  it('returns 0 for a zero duration', () => {
    expect(samplesForDurationMs(0)).toBe(0);
  });

  it('rounds fractional sample counts to the nearest sample', () => {
    expect(samplesForDurationMs(0.04)).toBe(1);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('rejects %s', (durationMs) => {
    expect(() => samplesForDurationMs(durationMs)).toThrow(RangeError);
  });
});
