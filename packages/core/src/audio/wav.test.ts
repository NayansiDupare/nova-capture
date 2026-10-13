import { describe, expect, it } from 'vitest';

import {
  bytesToPcm,
  decodeWav,
  encodeWav,
  pcmToBytes,
  WAV_HEADER_BYTES,
  wavHeader,
  WavFormatError,
} from './wav';

const ascii = (bytes: Uint8Array, from: number) =>
  String.fromCharCode(...bytes.subarray(from, from + 4));

describe('WAV encoding', () => {
  it('writes a 16 kHz mono 16-bit PCM header', () => {
    const header = wavHeader(3200);
    const view = new DataView(header.buffer);

    expect(header).toHaveLength(WAV_HEADER_BYTES);
    expect([ascii(header, 0), ascii(header, 8), ascii(header, 12), ascii(header, 36)]).toEqual([
      'RIFF',
      'WAVE',
      'fmt ',
      'data',
    ]);
    expect(view.getUint32(4, true)).toBe(36 + 3200);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(28, true)).toBe(32000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(3200);
  });

  it.each([-2, 3, 1.5])('rejects a data length of %s', (length) => {
    expect(() => wavHeader(length)).toThrow(RangeError);
  });

  it('round-trips samples, including the extremes', () => {
    const pcm = Int16Array.from([0, 1, -1, 32767, -32768, 1234]);
    const decoded = decodeWav(encodeWav(pcm));
    expect(decoded.sampleRate).toBe(16000);
    expect([...decoded.pcm]).toEqual([...pcm]);
  });

  it('writes little-endian samples', () => {
    expect([...pcmToBytes(Int16Array.from([0x0102, -2]))]).toEqual([0x02, 0x01, 0xfe, 0xff]);
  });

  it('ignores a trailing odd byte', () => {
    expect([...bytesToPcm(Uint8Array.from([0x02, 0x01, 0x07]))]).toEqual([0x0102]);
  });

  it('decodes a WAV inside a larger buffer', () => {
    const wav = encodeWav(Int16Array.from([5, 6]));
    const padded = new Uint8Array(wav.length + 8);
    padded.set(wav, 4);
    expect([...decodeWav(padded.subarray(4, 4 + wav.length)).pcm]).toEqual([5, 6]);
  });

  it('skips unknown chunks before the data', () => {
    const wav = encodeWav(Int16Array.from([7]));
    // 'LIST', size 3, three body bytes and one pad byte.
    const extra = Uint8Array.from([0x4c, 0x49, 0x53, 0x54, 3, 0, 0, 0, 1, 2, 3, 0]);
    const withList = new Uint8Array([...wav.subarray(0, 36), ...extra, ...wav.subarray(36)]);
    expect([...decodeWav(withList).pcm]).toEqual([7]);
  });
});

describe('WAV decoding errors', () => {
  const withField = (offset: number, value: number) => {
    const wav = encodeWav(Int16Array.from([1]));
    new DataView(wav.buffer).setUint16(offset, value, true);
    return wav;
  };

  it.each([
    ['not RIFF', new Uint8Array(44)],
    ['stereo', withField(22, 2)],
    ['8-bit', withField(34, 8)],
    ['float', withField(20, 3)],
    ['no data chunk', encodeWav(new Int16Array()).subarray(0, 36)],
  ])('rejects %s', (_label, bytes) => {
    expect(() => decodeWav(bytes)).toThrow(WavFormatError);
  });
});
