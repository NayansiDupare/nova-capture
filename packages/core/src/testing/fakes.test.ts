import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { FAKE_LLM_USAGE, FakeLLM, FakeSTT } from './index';
import { InvalidOutputError, ProviderError } from '../providers/providers';
import type { AudioChunk } from '../providers/providers';

const chunk = (index: number, startMs: number, endMs: number): AudioChunk => ({
  index,
  startMs,
  endMs,
  wav: new Uint8Array(),
});

describe('FakeSTT', () => {
  it('returns one segment per chunk by default, relative to the chunk start', async () => {
    const stt = new FakeSTT();
    const result = await stt.transcribeChunk(chunk(2, 60_000, 90_000), {});
    expect(result.segments).toEqual([{ startMs: 0, endMs: 30_000, text: 'chunk 2' }]);
  });

  it('follows the script, then falls back to the default', async () => {
    const outage = new ProviderError('Service unavailable', 'fake-stt', true, 503);
    const stt = new FakeSTT([outage, outage]);

    await expect(stt.transcribeChunk(chunk(0, 0, 1000), {})).rejects.toBe(outage);
    await expect(stt.transcribeChunk(chunk(0, 0, 1000), {})).rejects.toBe(outage);
    await expect(stt.transcribeChunk(chunk(0, 0, 1000), {})).resolves.toMatchObject({
      segments: [{ text: 'chunk 0' }],
    });
  });

  it('records each call with its options', async () => {
    const stt = new FakeSTT();
    await stt.transcribeChunk(chunk(1, 0, 1000), { prompt: 'previous sentence' });
    expect(stt.calls).toHaveLength(1);
    expect(stt.calls[0]?.opts).toEqual({ prompt: 'previous sentence' });
  });

  it('rejects an aborted call without consuming the script', async () => {
    const stt = new FakeSTT([{ segments: [] }]);
    await expect(
      stt.transcribeChunk(chunk(0, 0, 1000), { signal: { aborted: true } }),
    ).rejects.toThrow('Aborted');
    await expect(stt.transcribeChunk(chunk(0, 0, 1000), {})).resolves.toEqual({ segments: [] });
  });
});

describe('FakeLLM', () => {
  const NoteSchema = z.object({ title: z.string() });
  const request = { system: 'system', user: 'user', schema: NoteSchema, maxTokens: 100 };

  it('returns scripted output that matches the schema', async () => {
    const llm = new FakeLLM([{ output: { title: 'Fourier series' } }]);
    await expect(llm.generateStructured(request)).resolves.toEqual({
      data: { title: 'Fourier series' },
      usage: FAKE_LLM_USAGE,
    });
  });

  it('throws InvalidOutputError when the output does not match the schema', async () => {
    const llm = new FakeLLM([{ output: { heading: 'wrong field' } }]);
    const error: unknown = await llm.generateStructured(request).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InvalidOutputError);
    expect((error as InvalidOutputError).issues[0]?.path).toEqual(['title']);
  });

  it('supports a repair flow: invalid first, valid second', async () => {
    const llm = new FakeLLM([{ output: {} }, { output: { title: 'Fixed' } }]);
    await expect(llm.generateStructured(request)).rejects.toBeInstanceOf(InvalidOutputError);
    await expect(llm.generateStructured(request)).resolves.toMatchObject({
      data: { title: 'Fixed' },
    });
    expect(llm.calls).toHaveLength(2);
  });

  it('throws scripted errors', async () => {
    const quota = new ProviderError('Quota exceeded', 'fake-llm', true, 429);
    const llm = new FakeLLM([quota]);
    await expect(llm.generateStructured(request)).rejects.toBe(quota);
  });

  it('fails loudly when the script runs out', async () => {
    const llm = new FakeLLM([]);
    await expect(llm.generateStructured(request)).rejects.toThrow(/no scripted reply for call 1/);
  });

  it('rejects an aborted call', async () => {
    const llm = new FakeLLM([{ output: { title: 'unused' } }]);
    await expect(llm.generateStructured({ ...request, signal: { aborted: true } })).rejects.toThrow(
      'Aborted',
    );
  });
});
