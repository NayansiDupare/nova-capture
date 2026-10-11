import { readFileSync } from 'node:fs';

/** Reads a PCM WAV file and returns its bytes plus basic format info. */
export function readWav(path) {
  const bytes = readFileSync(path);
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${path} is not a WAV file`);
  }

  let fmt = null;
  let dataBytes = 0;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      fmt = {
        audioFormat: bytes.readUInt16LE(offset + 8),
        channels: bytes.readUInt16LE(offset + 10),
        sampleRate: bytes.readUInt32LE(offset + 12),
        bitsPerSample: bytes.readUInt16LE(offset + 22),
      };
    } else if (id === 'data') {
      dataBytes = Math.min(size, bytes.length - offset - 8);
    }
    offset += 8 + size + (size % 2);
  }
  if (!fmt) throw new Error(`${path} has no fmt chunk`);

  const bytesPerSecond = fmt.sampleRate * fmt.channels * (fmt.bitsPerSample / 8);
  return { bytes, ...fmt, durationSec: dataBytes / bytesPerSecond };
}
