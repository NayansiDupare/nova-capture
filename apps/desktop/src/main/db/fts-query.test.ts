import { describe, expect, it } from 'vitest';

import { toFtsQuery } from './fts-query';

describe('toFtsQuery', () => {
  it('quotes every word and lets a long last word match as a prefix', () => {
    expect(toFtsQuery('fourier')).toBe('"fourier"*');
    expect(toFtsQuery('four')).toBe('"four"*');
    expect(toFtsQuery('fourier transform')).toBe('"fourier" "transform"*');
  });

  it('keeps a short last word exact, because a short prefix matches too many words', () => {
    expect(toFtsQuery('the')).toBe('"the"');
    expect(toFtsQuery('fourier th')).toBe('"fourier" "th"');
  });

  it('only applies the prefix to the last word', () => {
    expect(toFtsQuery('fourier the')).toBe('"fourier" "the"');
  });

  it('does not count punctuation towards the prefix length', () => {
    expect(toFtsQuery('the)')).toBe('"the"');
    expect(toFtsQuery('t-h-e')).toBe('"t" "h" "e"');
  });

  it('removes FTS5 syntax, so keywords are searched as plain words', () => {
    expect(toFtsQuery('a AND b')).toBe('"a" "AND" "b"');
    expect(toFtsQuery('title:x')).toBe('"title" "x"');
    expect(toFtsQuery('NEAR(a b)')).toBe('"NEAR" "a" "b"');
    expect(toFtsQuery('say"hi')).toBe('"say" "hi"');
    expect(toFtsQuery('foo*')).toBe('"foo"');
  });

  it('keeps words in any script together', () => {
    expect(toFtsQuery('français')).toBe('"français"*');
    expect(toFtsQuery('हिन्दी')).toBe('"हिन्दी"*');
  });

  it('treats whitespace and control characters as separators', () => {
    expect(toFtsQuery('  a \t b\nc  ')).toBe('"a" "b" "c"');
    expect(toFtsQuery('a\0b')).toBe('"a" "b"');
  });

  it('returns null when there are no words', () => {
    expect(toFtsQuery('')).toBeNull();
    expect(toFtsQuery('   ')).toBeNull();
    expect(toFtsQuery('\0\u0001')).toBeNull();
    expect(toFtsQuery('!!!')).toBeNull();
    expect(toFtsQuery('"')).toBeNull();
  });
});
