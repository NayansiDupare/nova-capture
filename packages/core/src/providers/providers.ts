import type { z } from 'zod';

/**
 * The part of `AbortSignal` providers read. Core has no DOM or Node types (AGENTS.md §4.1);
 * a real `AbortSignal` satisfies this.
 */
export type CancelSignal = { readonly aborted: boolean };

/** One encoded audio window sent to an STT provider. Times are relative to the session start. */
export type AudioChunk = {
  readonly index: number;
  readonly startMs: number;
  readonly endMs: number;
  /** 16 kHz mono 16-bit PCM WAV bytes (ARCHITECTURE.md §5.1). */
  readonly wav: Uint8Array;
};

export type TranscriptSegment = {
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
  readonly confidence?: number;
};

/** A chunk's transcript. Segment times are relative to the chunk start (ARCHITECTURE.md §7). */
export type ChunkResult = {
  readonly segments: readonly TranscriptSegment[];
  readonly language?: string;
  readonly costEstimateUsd?: number;
};

export type TranscribeOptions = {
  readonly language?: string;
  /** Last sentence of the previous chunk, for continuity. */
  readonly prompt?: string;
  readonly signal?: CancelSignal;
};

/** ARCHITECTURE.md §7. Streaming (`openStream`) is added in Phase 6. */
export interface SpeechToTextProvider {
  readonly id: string;
  readonly capabilities: {
    readonly streaming: boolean;
    readonly maxChunkSec: number;
    readonly languages: 'auto' | readonly string[];
    readonly wordTimestamps: boolean;
  };
  transcribeChunk(chunk: AudioChunk, opts: TranscribeOptions): Promise<ChunkResult>;
}

export type LlmUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costEstimateUsd?: number;
};

export type StructuredRequest<T> = {
  readonly system: string;
  readonly user: string;
  readonly schema: z.ZodType<T>;
  readonly maxTokens: number;
  readonly signal?: CancelSignal;
};

/**
 * ARCHITECTURE.md §9. Implementations validate the model output against `schema`
 * and throw {@link InvalidOutputError} when it does not match.
 */
export interface LLMProvider {
  readonly id: string;
  generateStructured<T>(req: StructuredRequest<T>): Promise<{ data: T; usage: LlmUsage }>;
}

/** A provider call failed. `retryable` is true for network errors, 429 and 5xx (CODE_STYLE.md §6). */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly provider: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/** The LLM answered, but not in the requested shape. The caller may make one repair call. */
export class InvalidOutputError extends Error {
  constructor(
    readonly provider: string,
    readonly issues: readonly z.core.$ZodIssue[],
  ) {
    super(`${provider} returned output that does not match the schema`);
    this.name = 'InvalidOutputError';
  }
}
