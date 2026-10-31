import { z } from 'zod';

import { InvalidOutputError, ProviderError } from '@nova/core';
import type { LLMProvider, LlmUsage, StructuredRequest } from '@nova/core';

import type { FetchLike } from './groq-stt';

/**
 * USD per million tokens, standard paid tier. Thinking tokens bill as output. Checked
 * 13 Oct 2026 on pricing aggregators citing Google's page; confirm at
 * ai.google.dev/gemini-api/docs/pricing. Switching model is a cost decision for the user.
 */
export const GEMINI_USD_PER_MTOK = {
  'gemini-3.8-flash': { input: 0.75, output: 3.75 },
} as const;
export type GeminiModel = keyof typeof GEMINI_USD_PER_MTOK;

const DEFAULT_TIMEOUT_MS = 90_000;

const GeminiResponseSchema = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({
            parts: z
              .array(z.object({ text: z.string().optional(), thought: z.boolean().optional() }))
              .optional(),
          })
          .optional(),
        finishReason: z.string().optional(),
      }),
    )
    .optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().optional(),
      candidatesTokenCount: z.number().optional(),
      thoughtsTokenCount: z.number().optional(),
    })
    .optional(),
});
type GeminiResponse = z.infer<typeof GeminiResponseSchema>;

const GeminiErrorSchema = z.object({ error: z.object({ message: z.string() }) });

export type GeminiLlmOptions = {
  /** Read right before each request; the key is never cached here (SECURITY.md §5). */
  readonly getApiKey: () => string | undefined;
  readonly fetch?: FetchLike;
  readonly model?: GeminiModel;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
};

/**
 * Gemini `generateContent` with a response schema (verified in the Phase 0 spike):
 * `POST /v1beta/models/{model}:generateContent`, `x-goog-api-key` header,
 * `responseMimeType: application/json` + `responseSchema`. The prompt contains transcript
 * text, so neither the request nor the response body is ever logged.
 */
export class GeminiLlmProvider implements LLMProvider {
  readonly id = 'gemini';
  readonly model: GeminiModel;

  constructor(private readonly options: GeminiLlmOptions) {
    this.model = options.model ?? 'gemini-3.8-flash';
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<{ data: T; usage: LlmUsage }> {
    const apiKey = this.options.getApiKey();
    if (!apiKey) {
      throw new ProviderError('No Gemini API key saved. Add one in Settings.', this.id, false);
    }

    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const signal =
      req.signal instanceof AbortSignal ? AbortSignal.any([timeout, req.signal]) : timeout;
    const doFetch = this.options.fetch ?? fetch;
    const base = this.options.baseUrl ?? 'https://generativelanguage.googleapis.com';

    let response: Response;
    try {
      response = await doFetch(`${base}/v1beta/models/${this.model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: 'user', parts: [{ text: req.user }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: toGeminiSchema(z.toJSONSchema(req.schema)),
            temperature: 0.2,
            maxOutputTokens: req.maxTokens,
          },
        }),
        signal,
      });
    } catch (error) {
      if (req.signal?.aborted) {
        throw new ProviderError('Note generation cancelled', this.id, false);
      }
      // Network failure or timeout: worth retrying.
      throw new ProviderError(`Gemini request failed: ${errorName(error)}`, this.id, true);
    }

    if (!response.ok) {
      throw new ProviderError(
        `Gemini HTTP ${String(response.status)}: ${await errorMessage(response)}`,
        this.id,
        isRetryableStatus(response.status),
        response.status,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      // A truncated body is usually transient.
      throw new ProviderError('Gemini returned invalid JSON', this.id, true, response.status);
    }
    const parsed = GeminiResponseSchema.safeParse(body);
    if (!parsed.success) {
      // The API shape changed: retrying would only spend money.
      throw new ProviderError(
        'Gemini response has an unexpected shape',
        this.id,
        false,
        response.status,
      );
    }
    return this.toResult(req, parsed.data);
  }

  private toResult<T>(
    req: StructuredRequest<T>,
    body: GeminiResponse,
  ): { data: T; usage: LlmUsage } {
    const usage = this.usageOf(body);
    const candidate = body.candidates?.[0];
    const blockReason = body.promptFeedback?.blockReason;
    if (blockReason !== undefined || candidate === undefined) {
      // Asking again with the same transcript gets the same answer.
      throw new ProviderError(
        `Gemini declined to answer (${blockReason ?? 'no candidates'})`,
        this.id,
        false,
      );
    }
    const text = (candidate.content?.parts ?? [])
      .filter((part) => part.thought !== true)
      .map((part) => part.text ?? '')
      .join('');

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      const reason = candidate.finishReason ?? 'unknown';
      throw new InvalidOutputError(
        this.id,
        [
          {
            code: 'custom',
            path: [],
            message: `not valid JSON (finish reason ${reason})`,
            input: '',
          },
        ],
        usage,
      );
    }
    const result = req.schema.safeParse(json);
    if (!result.success) {
      throw new InvalidOutputError(this.id, result.error.issues, usage);
    }
    return { data: result.data, usage };
  }

  private usageOf(body: GeminiResponse): LlmUsage {
    const inputTokens = body.usageMetadata?.promptTokenCount ?? 0;
    const outputTokens =
      (body.usageMetadata?.candidatesTokenCount ?? 0) +
      (body.usageMetadata?.thoughtsTokenCount ?? 0);
    const price = GEMINI_USD_PER_MTOK[this.model];
    return {
      inputTokens,
      outputTokens,
      costEstimateUsd: (inputTokens * price.input + outputTokens * price.output) / 1_000_000,
    };
  }
}

type GeminiSchema = {
  type: string;
  properties?: Record<string, GeminiSchema>;
  required?: string[];
  items?: GeminiSchema;
};

/**
 * Converts the JSON Schema zod emits to the OpenAPI subset `responseSchema` accepts
 * (upper-case types, properties, required, items; the shape verified in the spike).
 * Length and range limits are dropped: zod validates the answer afterwards anyway.
 */
export function toGeminiSchema(schema: unknown): GeminiSchema {
  const parsed = JsonSchemaNodeSchema.parse(schema);
  const node: GeminiSchema = { type: parsed.type.toUpperCase() };
  if (parsed.properties) {
    node.properties = Object.fromEntries(
      Object.entries(parsed.properties).map(([key, value]) => [key, toGeminiSchema(value)]),
    );
  }
  if (parsed.required) node.required = parsed.required;
  if (parsed.items !== undefined) node.items = toGeminiSchema(parsed.items);
  return node;
}

const JsonSchemaNodeSchema = z.object({
  type: z.enum(['object', 'array', 'string', 'number', 'integer', 'boolean']),
  properties: z.record(z.string(), z.unknown()).optional(),
  required: z.array(z.string()).optional(),
  items: z.unknown().optional(),
});

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** Provider error messages describe the request, not the transcript, so they are safe to keep. */
async function errorMessage(response: Response): Promise<string> {
  try {
    const parsed = GeminiErrorSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.error.message.slice(0, 300) : response.statusText;
  } catch {
    return response.statusText;
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
