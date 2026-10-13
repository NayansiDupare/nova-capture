import { AUDIO_FORMAT, samplesForDurationMs } from '../audio-format';

/**
 * Synthetic test audio at the contract format. Energy-based VAD only sees loudness,
 * so a tone stands in for speech; real fixture recordings are not needed.
 */

/** A sine tone whose RMS level is `dbfs`. */
export function tone(durationMs: number, dbfs = -20, frequencyHz = 220): Int16Array {
  const amplitude = Math.SQRT2 * 10 ** (dbfs / 20) * 32767;
  return Int16Array.from({ length: samplesForDurationMs(durationMs) }, (_, i) =>
    Math.round(amplitude * Math.sin((2 * Math.PI * frequencyHz * i) / AUDIO_FORMAT.sampleRate)),
  );
}

export function silence(durationMs: number): Int16Array {
  return new Int16Array(samplesForDurationMs(durationMs));
}

export function concatPcm(...parts: readonly Int16Array[]): Int16Array {
  const out = new Int16Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Builds audio from a pattern like `[['speech', 2000], ['silence', 500]]`. */
export function speechPattern(
  ...parts: [kind: 'speech' | 'silence', durationMs: number][]
): Int16Array {
  return concatPcm(...parts.map(([kind, ms]) => (kind === 'speech' ? tone(ms) : silence(ms))));
}
