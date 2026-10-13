import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { encodeWav, ProviderError } from '@nova/core';
import type { AudioChunk } from '@nova/core';

import { GroqSttProvider } from './groq-stt';
import type { FetchLike } from './groq-stt';

// TESTING.md §3.4: adapters parse recorded responses; no live calls.
const fixture = (name: string) =>
  readFileSync(
    new URL(`../../../../../fixtures/providers/groq/${name}.json`, import.meta.url),
    'utf8',
  );

const respond =
  (status: number, body: string): FetchLike =>
  () =>
    Promise.resolve(
      new Response(body, { status, headers: { 'content-type': 'application/json' } }),
    );

const chunk: AudioChunk = {
  index: 2,
  startMs: 60_000,
  endMs: 90_000,
  wav: encodeWav(new Int16Array(16)),
};

/** `key: null` means no key is saved. */
const provider = (fetch: FetchLike, key: string | null = 'gsk_test_key') =>
  new GroqSttProvider({ getApiKey: () => key ?? undefined, fetch });

const failure = async (p: GroqSttProvider) => {
  const error: unknown = await p.transcribeChunk(chunk, {}).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
};

describe('GroqSttProvider', () => {
  it('sends the chunk as multipart verbose_json with the key as a bearer token', async () => {
    let request: { url: string; init: RequestInit } | undefined;
    const capture: FetchLike = (url, init) => {
      request = { url, init };
      return respond(200, fixture('transcription-success'))(url, init);
    };

    await provider(capture).transcribeChunk(chunk, { language: 'en', prompt: 'Fourier' });

    expect(request?.url).toBe('https://api.groq.com/openai/v1/audio/transcriptions');
    expect(request?.init.method).toBe('POST');
    expect(request?.init.headers).toEqual({ Authorization: 'Bearer gsk_test_key' });
    const form = request?.init.body as FormData;
    expect(form.get('model')).toBe('whisper-large-v3-turbo');
    expect(form.get('response_format')).toBe('verbose_json');
    expect(form.getAll('timestamp_granularities[]')).toEqual(['segment']);
    expect(form.get('language')).toBe('en');
    expect(form.get('prompt')).toBe('Fourier');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('parses segments relative to the chunk, dropping empty ones, and estimates cost', async () => {
    const result = await provider(respond(200, fixture('transcription-success'))).transcribeChunk(
      chunk,
      {},
    );
    expect(result.segments).toEqual([
      { startMs: 0, endMs: 3420, text: 'Today we look at the Fourier transform.' },
      { startMs: 3420, endMs: 7900, text: 'It maps a signal from time to frequency.' },
    ]);
    expect(result.language).toBe('English');
    // 30 s at $0.04 per hour.
    expect(result.costEstimateUsd).toBeCloseTo((30 / 3600) * 0.04, 8);
  });

  it('bills short chunks as 10 s', async () => {
    const short = { ...chunk, startMs: 0, endMs: 4000 };
    const result = await provider(
      respond(200, fixture('transcription-no-segments')),
    ).transcribeChunk(short, {});
    expect(result.costEstimateUsd).toBeCloseTo((10 / 3600) * 0.04, 8);
  });

  it('turns a reply without segments into one segment spanning the chunk', async () => {
    const result = await provider(
      respond(200, fixture('transcription-no-segments')),
    ).transcribeChunk(chunk, {});
    expect(result.segments).toEqual([{ startMs: 0, endMs: 30_000, text: 'Short answer.' }]);
  });

  it('fails permanently without calling Groq when no key is saved', async () => {
    let called = false;
    const error = await failure(
      provider(() => {
        called = true;
        return Promise.reject(new Error('unreachable'));
      }, null),
    );
    expect(error.retryable).toBe(false);
    expect(error.message).toMatch(/No Groq API key/);
    expect(called).toBe(false);
  });

  it.each([
    ['error-401', 401, false, /Invalid API Key/],
    ['error-429', 429, true, /Rate limit/],
    ['error-503', 503, true, /Service Unavailable/],
  ])('maps %s to a ProviderError (retryable: %s)', async (name, status, retryable, message) => {
    const error = await failure(provider(respond(status, fixture(name))));
    expect(error).toMatchObject({ provider: 'groq', status, retryable });
    expect(error.message).toMatch(message);
  });

  it('never puts the API key in an error', async () => {
    const error = await failure(provider(respond(401, fixture('error-401'))));
    expect(error.message).not.toContain('gsk_test_key');
  });

  it('retries network failures and timeouts', async () => {
    const error = await failure(provider(() => Promise.reject(new TypeError('fetch failed'))));
    expect(error.retryable).toBe(true);
  });

  it('does not retry a cancelled request', async () => {
    const controller = new AbortController();
    controller.abort();
    const p = provider(() => Promise.reject(new DOMException('aborted', 'AbortError')));
    const error: unknown = await p
      .transcribeChunk(chunk, { signal: controller.signal })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ retryable: false, message: 'Transcription cancelled' });
  });

  it('retries a truncated JSON body', async () => {
    const error = await failure(provider(respond(200, '{"text": "cut of')));
    expect(error.retryable).toBe(true);
  });

  it('does not retry an unexpected response shape', async () => {
    const error = await failure(provider(respond(200, fixture('unexpected-shape'))));
    expect(error.retryable).toBe(false);
  });

  it('falls back to the status text for a non-JSON error body', async () => {
    const error = await failure(provider(respond(502, '<html>Bad gateway</html>')));
    expect(error).toMatchObject({ status: 502, retryable: true });
  });
});
