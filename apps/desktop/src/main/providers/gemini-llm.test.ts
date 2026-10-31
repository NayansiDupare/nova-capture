import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { InvalidOutputError, ProviderError, QuickNoteOutputSchema } from '@nova/core';
import type { StructuredRequest } from '@nova/core';

import { GEMINI_USD_PER_MTOK, GeminiLlmProvider, toGeminiSchema } from './gemini-llm';
import type { FetchLike } from './groq-stt';
import { createLlmProvider } from './llm-registry';

// TESTING.md §3.4: adapters parse recorded responses; no live calls.
const fixture = (name: string) =>
  readFileSync(
    new URL(`../../../../../fixtures/providers/gemini/${name}.json`, import.meta.url),
    'utf8',
  );

const respond =
  (status: number, body: string): FetchLike =>
  () =>
    Promise.resolve(
      new Response(body, { status, headers: { 'content-type': 'application/json' } }),
    );

const request: StructuredRequest<z.infer<typeof QuickNoteOutputSchema>> = {
  system: 'Rules.',
  user: 'Write a quick note.',
  schema: QuickNoteOutputSchema,
  maxTokens: 8192,
};

/** `key: null` means no key is saved. */
const provider = (fetch: FetchLike, key: string | null = 'AIza_test_key') =>
  new GeminiLlmProvider({ getApiKey: () => key ?? undefined, fetch });

const failure = async (p: GeminiLlmProvider) => {
  const error: unknown = await p.generateStructured(request).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(ProviderError);
  return error as ProviderError;
};

const invalid = async (p: GeminiLlmProvider) => {
  const error: unknown = await p.generateStructured(request).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(InvalidOutputError);
  return error as InvalidOutputError;
};

describe('GeminiLlmProvider', () => {
  it('posts the prompt with a response schema and the key in a header', async () => {
    let call: { url: string; init: RequestInit } | undefined;
    const capture: FetchLike = (url, init) => {
      call = { url, init };
      return respond(200, fixture('generate-quick-success'))(url, init);
    };

    await provider(capture).generateStructured(request);

    expect(call?.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent',
    );
    expect(call?.init.method).toBe('POST');
    expect(call?.init.headers).toEqual({
      'x-goog-api-key': 'AIza_test_key',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(call?.init.body as string)).toEqual({
      systemInstruction: { parts: [{ text: 'Rules.' }] },
      contents: [{ role: 'user', parts: [{ text: 'Write a quick note.' }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            title: { type: 'STRING' },
            gist: { type: 'STRING' },
            tags: { type: 'ARRAY', items: { type: 'STRING' } },
            language: { type: 'STRING' },
          },
          required: ['title', 'gist', 'tags', 'language'],
        },
        temperature: 0.2,
        maxOutputTokens: 8192,
      },
    });
  });

  it('parses the note and bills thinking tokens as output', async () => {
    const result = await provider(
      respond(200, fixture('generate-quick-success')),
    ).generateStructured(request);

    expect(result.data).toEqual({
      title: 'Fourier transform basics',
      gist: 'The Fourier transform maps a signal from time to frequency.',
      tags: ['signal-processing', 'math'],
      language: 'en',
    });
    const price = GEMINI_USD_PER_MTOK['gemini-3.8-flash'];
    expect(result.usage).toEqual({
      inputTokens: 745,
      outputTokens: 202,
      costEstimateUsd: expect.closeTo((745 * price.input + 202 * price.output) / 1e6, 10) as number,
    });
  });

  it('ignores thought parts', async () => {
    const result = await provider(
      respond(200, fixture('generate-thought-parts')),
    ).generateStructured(request);
    expect(result.data.title).toBe('Fourier');
  });

  it('reports truncated output as invalid, with the finish reason and the billed usage', async () => {
    const error = await invalid(provider(respond(200, fixture('generate-truncated'))));
    expect(error.issues[0]?.message).toBe('not valid JSON (finish reason MAX_TOKENS)');
    expect(error.usage?.outputTokens).toBe(8192);
  });

  it('reports output that misses a field as invalid, naming the field', async () => {
    const error = await invalid(provider(respond(200, fixture('generate-wrong-shape'))));
    expect(error.issues.map((i) => i.path.join('.'))).toEqual(['gist']);
  });

  it('fails permanently when the prompt is blocked', async () => {
    const error = await failure(provider(respond(200, fixture('generate-blocked'))));
    expect(error).toMatchObject({
      retryable: false,
      message: expect.stringContaining('SAFETY') as string,
    });
  });

  it('fails permanently when no key is saved, without calling the API', async () => {
    let called = false;
    const error = await failure(
      provider(() => {
        called = true;
        return Promise.reject(new Error('unreachable'));
      }, null),
    );
    expect(error.retryable).toBe(false);
    expect(called).toBe(false);
  });

  it.each([
    ['error-400-invalid-key', 400, false, 'API key not valid'],
    ['error-429', 429, true, 'Resource has been exhausted'],
    ['error-503', 503, true, 'overloaded'],
  ])('maps %s to retryable=%s', async (name, status, retryable, text) => {
    const error = await failure(provider(respond(status, fixture(name))));
    expect(error).toMatchObject({ status, retryable });
    expect(error.message).toContain(text);
    expect(error.message).not.toContain('AIza_test_key');
  });

  it('uses the status text when the error body is not JSON', async () => {
    const error = await failure(provider(respond(502, '<html>Bad gateway</html>')));
    expect(error).toMatchObject({ status: 502, retryable: true });
  });

  it('fails permanently on an unexpected response shape', async () => {
    const error = await failure(provider(respond(200, fixture('unexpected-shape'))));
    expect(error.retryable).toBe(false);
  });

  it('retries a truncated response body', async () => {
    const error = await failure(provider(respond(200, '{"candidates": [')));
    expect(error.retryable).toBe(true);
  });

  it('retries network failures and timeouts', async () => {
    const error = await failure(provider(() => Promise.reject(new TypeError('fetch failed'))));
    expect(error.retryable).toBe(true);
    expect(error.message).toContain('fetch failed');
  });

  it('does not retry a cancelled request', async () => {
    const controller = new AbortController();
    controller.abort();
    const error: unknown = await provider(() => Promise.reject(new Error('aborted')))
      .generateStructured({ ...request, signal: controller.signal })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ retryable: false, message: 'Note generation cancelled' });
  });
});

describe('toGeminiSchema', () => {
  it('keeps types, properties, required and items, and drops limits', () => {
    const schema = z.object({
      n: z.number().min(0),
      i: z.number().int(),
      b: z.boolean(),
      list: z.array(z.object({ s: z.string().max(3) })).min(1),
    });
    expect(toGeminiSchema(z.toJSONSchema(schema))).toEqual({
      type: 'OBJECT',
      properties: {
        n: { type: 'NUMBER' },
        i: { type: 'INTEGER' },
        b: { type: 'BOOLEAN' },
        list: {
          type: 'ARRAY',
          items: { type: 'OBJECT', properties: { s: { type: 'STRING' } }, required: ['s'] },
        },
      },
      required: ['n', 'i', 'b', 'list'],
    });
  });

  it('rejects schemas it cannot express, such as unions', () => {
    expect(() => toGeminiSchema(z.toJSONSchema(z.union([z.string(), z.number()])))).toThrow();
  });
});

describe('createLlmProvider', () => {
  it('builds Gemini with the key from the secret store', () => {
    const llm = createLlmProvider('gemini', { reveal: () => 'k' });
    expect(llm).toBeInstanceOf(GeminiLlmProvider);
    expect(llm.model).toBe('gemini-3.8-flash');
  });
});
