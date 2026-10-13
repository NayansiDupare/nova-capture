import { AUDIO_FORMAT } from '../audio-format';

export const WAV_HEADER_BYTES = 44;

const BYTES_PER_SAMPLE = 2;

export class WavFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WavFormatError';
  }
}

/**
 * A 44-byte PCM WAV header for `dataByteLength` bytes of 16-bit mono samples.
 * Prepend it to raw spool bytes to build a chunk without copying samples through JS.
 */
export function wavHeader(
  dataByteLength: number,
  sampleRate: number = AUDIO_FORMAT.sampleRate,
): Uint8Array {
  if (!Number.isInteger(dataByteLength) || dataByteLength < 0 || dataByteLength % 2 !== 0) {
    throw new RangeError(
      `dataByteLength must be an even, non-negative integer, got ${String(dataByteLength)}`,
    );
  }
  const header = new Uint8Array(WAV_HEADER_BYTES);
  const view = new DataView(header.buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataByteLength, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, AUDIO_FORMAT.channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * BYTES_PER_SAMPLE * AUDIO_FORMAT.channels, true); // byte rate
  view.setUint16(32, BYTES_PER_SAMPLE * AUDIO_FORMAT.channels, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataByteLength, true);
  return header;
}

/** Encodes 16-bit mono samples as a WAV file. */
export function encodeWav(
  pcm: Int16Array,
  sampleRate: number = AUDIO_FORMAT.sampleRate,
): Uint8Array {
  const bytes = new Uint8Array(WAV_HEADER_BYTES + pcm.length * BYTES_PER_SAMPLE);
  bytes.set(wavHeader(pcm.length * BYTES_PER_SAMPLE, sampleRate));
  bytes.set(pcmToBytes(pcm), WAV_HEADER_BYTES);
  return bytes;
}

export type DecodedWav = { readonly sampleRate: number; readonly pcm: Int16Array };

/**
 * Decodes a 16-bit mono PCM WAV file, as every fixture and chunk in this app is.
 *
 * @throws {WavFormatError} for anything else.
 */
export function decodeWav(bytes: Uint8Array): DecodedWav {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || readAscii(view, 0) !== 'RIFF' || readAscii(view, 8) !== 'WAVE') {
    throw new WavFormatError('Not a RIFF/WAVE file');
  }

  let sampleRate: number | undefined;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = readAscii(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      const format = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true);
      const bits = view.getUint16(body + 14, true);
      if (format !== 1 || channels !== 1 || bits !== 16) {
        throw new WavFormatError(
          `Expected 16-bit mono PCM, got format ${String(format)}, ${String(channels)} channels, ${String(bits)} bits`,
        );
      }
      sampleRate = view.getUint32(body + 4, true);
    } else if (id === 'data') {
      if (sampleRate === undefined) {
        throw new WavFormatError('data chunk before fmt chunk');
      }
      const end = Math.min(body + size, bytes.length);
      return { sampleRate, pcm: bytesToPcm(bytes.subarray(body, end - ((end - body) % 2))) };
    }
    offset = body + size + (size % 2);
  }
  throw new WavFormatError('No data chunk');
}

/** Little-endian bytes of `pcm`, regardless of the host's byte order. */
export function pcmToBytes(pcm: Int16Array): Uint8Array {
  const bytes = new Uint8Array(pcm.length * BYTES_PER_SAMPLE);
  const view = new DataView(bytes.buffer);
  pcm.forEach((sample, i) => {
    view.setInt16(i * BYTES_PER_SAMPLE, sample, true);
  });
  return bytes;
}

/** Samples from little-endian bytes. A trailing odd byte is ignored. */
export function bytesToPcm(bytes: Uint8Array): Int16Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pcm = new Int16Array(Math.floor(bytes.length / BYTES_PER_SAMPLE));
  for (let i = 0; i < pcm.length; i++) {
    pcm[i] = view.getInt16(i * BYTES_PER_SAMPLE, true);
  }
  return pcm;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

function readAscii(view: DataView, offset: number): string {
  let text = '';
  for (let i = 0; i < 4 && offset + i < view.byteLength; i++) {
    text += String.fromCharCode(view.getUint8(offset + i));
  }
  return text;
}
