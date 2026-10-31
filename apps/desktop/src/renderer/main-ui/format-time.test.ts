import { describe, expect, it } from 'vitest';

import { formatTime } from './format-time';

describe('formatTime', () => {
  it.each([
    [0, '0:00'],
    [61_999, '1:01'],
    [3_599_000, '59:59'],
    [3_661_000, '1:01:01'],
    [-5, '0:00'],
  ])('%i ms → %s', (ms, text) => {
    expect(formatTime(ms)).toBe(text);
  });
});
