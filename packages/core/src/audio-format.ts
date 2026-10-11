/** The PCM format every `AudioSource` delivers (ARCHITECTURE.md §5.1). */
export const AUDIO_FORMAT = {
  sampleRate: 16000,
  channels: 1,
  encoding: 'pcm_s16le',
} as const;

export type AudioFormat = typeof AUDIO_FORMAT;

/**
 * Number of samples covering `durationMs` at the contract sample rate.
 * Rounds to the nearest whole sample.
 */
export function samplesForDurationMs(durationMs: number): number {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new RangeError(
      `durationMs must be a finite, non-negative number, got ${String(durationMs)}`,
    );
  }
  return Math.round((durationMs * AUDIO_FORMAT.sampleRate) / 1000);
}
