import type { GroundingFlag, KeyPoint, KeyPointEdit } from './note';
import type { TranscriptSegment } from '../providers/providers';

/** Model time ranges are rounded to tenths of a second, so allow a little slack. */
const RANGE_TOLERANCE_MS = 1000;

/** Text in double quotes, curly quotes or backticks. Single quotes are skipped: apostrophes. */
const QUOTED = /"([^"]+)"|“([^”]+)”|`([^`]+)`/gu;

/**
 * The cheap ground check (ARCHITECTURE.md §9): flags key points whose time range matches no
 * transcript segment, or that quote a term the transcript never contains. A flag is a hint
 * for the reviewer, not proof of a hallucination.
 */
export function groundKeyPoints(
  keyPoints: readonly KeyPointEdit[],
  transcript: readonly TranscriptSegment[],
): KeyPoint[] {
  const transcriptText = normalize(transcript.map((s) => s.text).join(' '));
  return keyPoints.map((point) => {
    const flags: GroundingFlag[] = [];
    if (!transcript.some((segment) => overlaps(point, segment))) {
      flags.push('time-range-not-in-transcript');
    }
    if (quotedTerms(point.text).some((term) => !containsWords(transcriptText, term))) {
      flags.push('quoted-term-missing');
    }
    return { ...point, flags };
  });
}

/** The terms a key point puts in quotes, normalized; empty ones dropped. */
export function quotedTerms(text: string): string[] {
  return [...text.matchAll(QUOTED)]
    .map((match) => normalize(match[1] ?? match[2] ?? match[3] ?? ''))
    .filter((term) => term !== '');
}

function overlaps(point: KeyPointEdit, segment: TranscriptSegment): boolean {
  return (
    segment.startMs <= point.endMs + RANGE_TOLERANCE_MS &&
    segment.endMs >= point.startMs - RANGE_TOLERANCE_MS
  );
}

/** Whole-word match, so a quoted "art" is not found inside "start". */
function containsWords(haystack: string, needle: string): boolean {
  return ` ${haystack} `.includes(` ${needle} `);
}

/** Case-, accent-form- and punctuation-insensitive text, words separated by single spaces. */
function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}
