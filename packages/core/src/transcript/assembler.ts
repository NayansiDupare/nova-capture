import type { ChunkPlan } from '../audio/chunk-planner';
import type { ChunkResult, TranscriptSegment } from '../providers/providers';

export type TranscribedChunk = { readonly chunk: ChunkPlan; readonly result: ChunkResult };

/** How many words at each chunk edge are compared when looking for duplicated text. */
const EDGE_WORDS = 40;
/** A match must be at least this long, so one common word ("the") is not taken as overlap. */
const MIN_MATCH_WORDS = 2;
/** Words the next chunk may start with before the duplicate (a clipped first word, a filler). */
const MAX_LEADING_SKIP = 3;

/**
 * Builds the canonical transcript (ARCHITECTURE.md §7): shifts each chunk's segment times by
 * the chunk start and removes words repeated in the overlap between consecutive chunks.
 *
 * Duplicates are found by aligning the last words of the transcript so far with the first
 * words of the next chunk. If the text does not line up, segments whose midpoint falls in the
 * first half of the overlap are dropped from the next chunk instead.
 */
export function assembleTranscript(chunks: readonly TranscribedChunk[]): TranscriptSegment[] {
  const ordered = [...chunks].sort((a, b) => a.chunk.startMs - b.chunk.startMs);
  const transcript: TranscriptSegment[] = [];
  let previousEndMs = Number.NEGATIVE_INFINITY;

  for (const { chunk, result } of ordered) {
    let segments = result.segments
      .map((s) => ({ ...s, startMs: s.startMs + chunk.startMs, endMs: s.endMs + chunk.startMs }))
      .filter((s) => s.text.trim() !== '');

    if (chunk.startMs < previousEndMs) {
      segments = removeOverlap(transcript, segments, chunk.startMs, previousEndMs);
    }
    transcript.push(...segments);
    previousEndMs = Math.max(previousEndMs, chunk.endMs);
  }
  return transcript;
}

function removeOverlap(
  before: readonly TranscriptSegment[],
  next: TranscriptSegment[],
  overlapStartMs: number,
  overlapEndMs: number,
): TranscriptSegment[] {
  const tail = before
    .flatMap((s) => words(s.text))
    .map(normalize)
    .filter((w) => w !== '')
    .slice(-EDGE_WORDS);
  const head = next
    .flatMap((s) => words(s.text))
    .map(normalize)
    .filter((w) => w !== '')
    .slice(0, EDGE_WORDS);

  const duplicateWords = findDuplicatePrefix(tail, head);
  if (duplicateWords > 0) {
    return dropLeadingWords(next, duplicateWords, overlapEndMs);
  }
  const midpointMs = (overlapStartMs + overlapEndMs) / 2;
  return next.filter((s) => (s.startMs + s.endMs) / 2 >= midpointMs);
}

/**
 * Length of the leading part of `head` that repeats the end of `tail`, including up to
 * {@link MAX_LEADING_SKIP} words before the repeat. Prefers the longest repeat, so
 * repeated phrases ("thank you thank you") are removed whole. 0 if none.
 */
function findDuplicatePrefix(tail: readonly string[], head: readonly string[]): number {
  for (let length = Math.min(tail.length, head.length); length >= MIN_MATCH_WORDS; length--) {
    const suffix = tail.slice(-length);
    for (let skip = 0; skip <= MAX_LEADING_SKIP && skip + length <= head.length; skip++) {
      if (suffix.every((word, i) => head[skip + i] === word)) {
        return skip + length;
      }
    }
  }
  return 0;
}

/** Removes `count` non-punctuation words from the front of `segments`. */
function dropLeadingWords(
  segments: readonly TranscriptSegment[],
  count: number,
  notBeforeMs: number,
): TranscriptSegment[] {
  let remaining = count;
  const kept: TranscriptSegment[] = [];
  for (const segment of segments) {
    if (remaining === 0) {
      kept.push(segment);
      continue;
    }
    const tokens = words(segment.text);
    let cut = 0;
    while (cut < tokens.length && remaining > 0) {
      if (normalize(tokens[cut] ?? '') !== '') {
        remaining--;
      }
      cut++;
    }
    const rest = tokens.slice(cut).join(' ');
    if (normalize(rest) !== '') {
      // The removed words were spoken before the previous chunk ended.
      const startMs = Math.min(Math.max(segment.startMs, notBeforeMs), segment.endMs);
      kept.push({ ...segment, startMs, text: rest });
    }
  }
  return kept;
}

function words(text: string): string[] {
  return text.split(/\s+/).filter((w) => w !== '');
}

function normalize(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, '');
}
