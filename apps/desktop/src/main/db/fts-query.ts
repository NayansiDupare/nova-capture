/**
 * The shortest last word that also matches as a prefix. A prefix costs as much as the share of
 * all spoken words it covers: with 3,000 one-hour notes "the*" (about 9%) takes about 3.5 s, and
 * one covering 1.5% takes about 0.4 s, the same as a very common whole word (ADR 0007).
 */
const MIN_PREFIX_LENGTH = 4;

/**
 * Turns what the user typed into an FTS5 MATCH expression, or null if it holds no words. Only
 * runs of letters, marks and digits get through, each one quoted, so FTS5 syntax (AND, NEAR, -,
 * :, *) can never raise a syntax error. A long enough last word also matches as a prefix, so
 * results appear while typing.
 */
export function toFtsQuery(input: string): string | null {
  const words = input.match(/[\p{L}\p{M}\p{N}]+/gu);
  if (!words) return null;
  const quoted = words.map((word) => `"${word}"`).join(' ');
  return (words.at(-1)?.length ?? 0) >= MIN_PREFIX_LENGTH ? `${quoted}*` : quoted;
}
