import type { SpeechSpan } from './vad';

/** One window of the spool to send to STT. Times are relative to the session start. */
export type ChunkPlan = {
  readonly index: number;
  readonly startMs: number;
  readonly endMs: number;
};

export type ChunkPlanOptions = {
  /** Preferred chunk length (ARCHITECTURE.md §6: ~30 s). */
  readonly targetMs: number;
  /** How far from the target a silence may be and still be used as the cut point. */
  readonly searchMs: number;
  /** Overlap added when no silence is found and a cut has to land inside speech. */
  readonly overlapMs: number;
  /** Kept around each speech span so word onsets and endings are not clipped. */
  readonly padMs: number;
};

export const DEFAULT_CHUNK_PLAN_OPTIONS: ChunkPlanOptions = {
  targetMs: 30_000,
  searchMs: 5_000,
  overlapMs: 1_500,
  padMs: 200,
};

/**
 * Splits a recording into chunks that cover all speech and skip leading, trailing and
 * between-chunk silence (which providers bill for).
 *
 * - Cuts at the silence nearest the target length, within `searchMs`; the next chunk starts
 *   where speech resumes, so silence cuts need no overlap.
 * - If the target lands inside a long silence, cuts where that silence begins.
 * - Otherwise cuts at the target inside speech and starts the next chunk `overlapMs` earlier;
 *   the transcript assembler removes the duplicated words.
 *
 * Deterministic: re-planning the same spool after a crash gives the same chunks.
 * No chunk is longer than `targetMs + searchMs`.
 */
export function planChunks(
  durationMs: number,
  speech: readonly SpeechSpan[],
  options: ChunkPlanOptions = DEFAULT_CHUNK_PLAN_OPTIONS,
): ChunkPlan[] {
  const spans = padAndMerge(speech, options.padMs, durationMs);
  const first = spans[0];
  const last = spans.at(-1);
  if (!first || !last) {
    return [];
  }
  const gaps = spans.slice(1).map((span, i) => ({
    startMs: spans[i]?.endMs ?? span.startMs,
    endMs: span.startMs,
  }));

  const chunks: ChunkPlan[] = [];
  const push = (startMs: number, endMs: number) =>
    chunks.push({ index: chunks.length, startMs, endMs });

  let cursor = first.startMs;
  while (cursor < last.endMs) {
    if (last.endMs - cursor <= options.targetMs + options.searchMs) {
      push(cursor, last.endMs);
      break;
    }
    const ideal = cursor + options.targetMs;
    const ahead = gaps.filter((gap) => gap.startMs > cursor);
    const nearby = ahead
      .filter((gap) => Math.abs(gap.startMs - ideal) <= options.searchMs)
      .sort((a, b) => Math.abs(a.startMs - ideal) - Math.abs(b.startMs - ideal))[0];
    const covering = ahead.find((gap) => gap.startMs <= ideal && gap.endMs > ideal);
    const silence = nearby ?? covering;

    if (silence) {
      push(cursor, silence.startMs);
      cursor = silence.endMs;
    } else {
      push(cursor, ideal);
      cursor = ideal - options.overlapMs;
    }
  }
  return chunks;
}

function padAndMerge(
  speech: readonly SpeechSpan[],
  padMs: number,
  durationMs: number,
): SpeechSpan[] {
  const merged: SpeechSpan[] = [];
  const sorted = [...speech].sort((a, b) => a.startMs - b.startMs);
  for (const span of sorted) {
    const startMs = Math.max(0, span.startMs - padMs);
    const endMs = Math.min(durationMs, span.endMs + padMs);
    if (endMs <= startMs) {
      continue;
    }
    const prev = merged.at(-1);
    if (prev && startMs <= prev.endMs) {
      merged[merged.length - 1] = { startMs: prev.startMs, endMs: Math.max(prev.endMs, endMs) };
    } else {
      merged.push({ startMs, endMs });
    }
  }
  return merged;
}
