import { z } from 'zod';

import { ProviderError } from '@nova/core';
import type {
  AudioChunk,
  ChunkResult,
  SpeechToTextProvider,
  TranscribeOptions,
  TranscriptSegment,
} from '@nova/core';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Published rates in USD per audio hour (checked 11 Oct 2026). Turbo is the cheap default;
 * switching model is a cost decision for the user.
 */
export const GROQ_USD_PER_HOUR = {
  'whisper-large-v3-turbo': 0.04,
  'whisper-large-v3': 0.111,
} as const;
export type GroqModel = keyof typeof GROQ_USD_PER_HOUR;

/** Groq bills at least 10 s per request. */
const MIN_BILLED_SEC = 10;
const DEFAULT_TIMEOUT_MS = 60_000;

const GroqResponseSchema = z.object({
  text: z.string(),
  language: z.string().optional(),
  segments: z.array(z.object({ start: z.number(), end: z.number(), text: z.string() })).optional(),
});

const GroqErrorSchema = z.object({ error: z.object({ message: z.string() }) });

export type GroqSttOptions = {
  /** Read right before each request; the key is never cached here (SECURITY.md §5). */
  readonly getApiKey: () => string | undefined;
  readonly fetch?: FetchLike;
  readonly model?: GroqModel;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
};

/**
 * Groq Whisper over the OpenAI-compatible endpoint (verified in the Phase 0 spike):
 * `POST /openai/v1/audio/transcriptions`, multipart, `verbose_json` with segment timestamps.
 */
export class GroqSttProvider implements SpeechToTextProvider {
  readonly id = 'groq';
  readonly capabilities = {
    streaming: false,
    // The real limit is 25 MB (~13 min of 16 kHz WAV); our chunks are at most 35 s.
    maxChunkSec: 600,
    languages: 'auto',
    wordTimestamps: false,
  } as const;
  private readonly model: GroqModel;

  constructor(private readonly options: GroqSttOptions) {
    this.model = options.model ?? 'whisper-large-v3-turbo';
  }

  async transcribeChunk(chunk: AudioChunk, opts: TranscribeOptions): Promise<ChunkResult> {
    const apiKey = this.options.getApiKey();
    if (!apiKey) {
      throw new ProviderError('No Groq API key saved. Add one in Settings.', this.id, false);
    }

    const form = new FormData();
    form.set(
      'file',
      new Blob([chunk.wav], { type: 'audio/wav' }),
      `chunk-${String(chunk.index)}.wav`,
    );
    form.set('model', this.model);
    form.set('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');
    if (opts.language) form.set('language', opts.language);
    if (opts.prompt) form.set('prompt', opts.prompt);

    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const signal =
      opts.signal instanceof AbortSignal ? AbortSignal.any([timeout, opts.signal]) : timeout;
    const doFetch = this.options.fetch ?? fetch;

    let response: Response;
    try {
      response = await doFetch(
        `${this.options.baseUrl ?? 'https://api.groq.com'}/openai/v1/audio/transcriptions`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
          signal,
        },
      );
    } catch (error) {
      if (opts.signal?.aborted) {
        throw new ProviderError('Transcription cancelled', this.id, false);
      }
      // Network failure or timeout: worth retrying.
      throw new ProviderError(`Groq request failed: ${errorName(error)}`, this.id, true);
    }

    if (!response.ok) {
      throw new ProviderError(
        `Groq HTTP ${String(response.status)}: ${await errorMessage(response)}`,
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
      throw new ProviderError('Groq returned invalid JSON', this.id, true, response.status);
    }
    const parsed = GroqResponseSchema.safeParse(body);
    if (!parsed.success) {
      // The API shape changed: retrying would only spend money.
      throw new ProviderError(
        'Groq response has an unexpected shape',
        this.id,
        false,
        response.status,
      );
    }
    return this.toChunkResult(chunk, parsed.data);
  }

  private toChunkResult(chunk: AudioChunk, body: z.infer<typeof GroqResponseSchema>): ChunkResult {
    const durationMs = chunk.endMs - chunk.startMs;
    const segments: TranscriptSegment[] = (body.segments ?? [])
      .map((s) => ({
        startMs: Math.round(s.start * 1000),
        endMs: Math.round(s.end * 1000),
        text: s.text.trim(),
      }))
      .filter((s) => s.text !== '');
    if (segments.length === 0 && body.text.trim() !== '') {
      segments.push({ startMs: 0, endMs: durationMs, text: body.text.trim() });
    }
    const billedSec = Math.max(MIN_BILLED_SEC, durationMs / 1000);
    const costEstimateUsd = (billedSec / 3600) * GROQ_USD_PER_HOUR[this.model];
    return body.language === undefined
      ? { segments, costEstimateUsd }
      : { segments, language: body.language, costEstimateUsd };
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** Provider error messages describe the request, not the audio, so they are safe to keep. */
async function errorMessage(response: Response): Promise<string> {
  try {
    const parsed = GroqErrorSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.error.message.slice(0, 300) : response.statusText;
  } catch {
    return response.statusText;
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
