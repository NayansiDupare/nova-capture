import { describe, expect, it } from 'vitest';

import { backoffDelayMs } from './backoff';

const options = (random: number) => ({ baseMs: 1000, maxMs: 10_000, random: () => random });

describe('backoffDelayMs', () => {
  it('grows exponentially', () => {
    expect([1, 2, 3, 4].map((a) => backoffDelayMs(a, options(0)))).toEqual([500, 1000, 2000, 4000]);
  });

  it('applies jitter within the upper half of the ceiling', () => {
    expect(backoffDelayMs(3, options(0))).toBe(2000);
    expect(backoffDelayMs(3, options(0.999))).toBe(3998);
  });

  it('is capped at maxMs', () => {
    expect(backoffDelayMs(20, options(0.999))).toBeLessThanOrEqual(10_000);
    expect(backoffDelayMs(20, options(0))).toBe(5000);
  });

  it.each([0, -1, 1.5])('rejects attempt %s', (attempt) => {
    expect(() => backoffDelayMs(attempt, options(0))).toThrow(RangeError);
  });
});
