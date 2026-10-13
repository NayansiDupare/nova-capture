/** Every `AudioSource` frame is 100 ms (ARCHITECTURE.md §5.1); levels are one value per frame. */
export const FRAME_MS = 100;

/** A stretch of detected speech. Times are relative to the session start. */
export type SpeechSpan = { readonly startMs: number; readonly endMs: number };

export type VadOptions = {
  /** Frames at or above this RMS level count as speech. */
  readonly thresholdDbfs: number;
  /** Speech shorter than this is dropped as a click or blip. */
  readonly minSpeechMs: number;
  /** Silence shorter than this is a pause inside speech, not a gap. */
  readonly minSilenceMs: number;
};

/**
 * Energy-based defaults (ARCHITECTURE.md §6). Loopback silence is near -inf dBFS and lecture
 * speech sits around -35 to -15, so -45 has a wide margin. It cannot tell speech from music;
 * the music heuristic comes later.
 */
export const DEFAULT_VAD_OPTIONS: VadOptions = {
  thresholdDbfs: -45,
  minSpeechMs: 300,
  minSilenceMs: 500,
};

/** RMS level of one frame in dBFS; `-Infinity` for digital silence or an empty frame. */
export function frameLevelDbfs(frame: Int16Array): number {
  if (frame.length === 0) {
    return Number.NEGATIVE_INFINITY;
  }
  let sumSquares = 0;
  for (const sample of frame) {
    const s = sample / 32768;
    sumSquares += s * s;
  }
  const rms = Math.sqrt(sumSquares / frame.length);
  return rms > 0 ? 20 * Math.log10(rms) : Number.NEGATIVE_INFINITY;
}

/**
 * Speech spans from per-frame levels (one per {@link FRAME_MS}): threshold each frame,
 * bridge short pauses, then drop blips.
 */
export function detectSpeech(
  levelsDbfs: readonly number[],
  options: VadOptions = DEFAULT_VAD_OPTIONS,
): SpeechSpan[] {
  const raw: SpeechSpan[] = [];
  let start: number | undefined;
  levelsDbfs.forEach((level, i) => {
    const isSpeech = level >= options.thresholdDbfs;
    if (isSpeech && start === undefined) {
      start = i;
    } else if (!isSpeech && start !== undefined) {
      raw.push({ startMs: start * FRAME_MS, endMs: i * FRAME_MS });
      start = undefined;
    }
  });
  if (start !== undefined) {
    raw.push({ startMs: start * FRAME_MS, endMs: levelsDbfs.length * FRAME_MS });
  }

  const bridged: SpeechSpan[] = [];
  for (const span of raw) {
    const last = bridged.at(-1);
    if (last && span.startMs - last.endMs < options.minSilenceMs) {
      bridged[bridged.length - 1] = { startMs: last.startMs, endMs: span.endMs };
    } else {
      bridged.push(span);
    }
  }
  return bridged.filter((span) => span.endMs - span.startMs >= options.minSpeechMs);
}

/** Share of `durationMs` covered by speech, from 0 to 1. Decides the note mode and warnings. */
export function speechRatio(spans: readonly SpeechSpan[], durationMs: number): number {
  if (durationMs <= 0) {
    return 0;
  }
  const speechMs = spans.reduce((sum, span) => sum + (span.endMs - span.startMs), 0);
  return Math.min(1, speechMs / durationMs);
}
