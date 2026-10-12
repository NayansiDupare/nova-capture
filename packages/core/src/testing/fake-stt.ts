import type {
  AudioChunk,
  ChunkResult,
  SpeechToTextProvider,
  TranscribeOptions,
} from '../providers/providers';

/** One scripted reply: a result, or an error to throw. */
export type FakeSttStep = ChunkResult | Error;

/** Without a script, each chunk becomes one segment spanning the whole chunk. */
export function defaultChunkResult(chunk: AudioChunk): ChunkResult {
  return {
    segments: [
      { startMs: 0, endMs: chunk.endMs - chunk.startMs, text: `chunk ${String(chunk.index)}` },
    ],
    language: 'en',
    costEstimateUsd: 0,
  };
}

/**
 * Test double for {@link SpeechToTextProvider}. Replies follow `script` in order,
 * then fall back to {@link defaultChunkResult}. Every call is recorded in `calls`.
 */
export class FakeSTT implements SpeechToTextProvider {
  readonly id = 'fake-stt';
  readonly capabilities = {
    streaming: false,
    maxChunkSec: 60,
    languages: 'auto',
    wordTimestamps: false,
  } as const;
  readonly calls: { chunk: AudioChunk; opts: TranscribeOptions }[] = [];
  private readonly script: FakeSttStep[];

  constructor(script: readonly FakeSttStep[] = []) {
    this.script = [...script];
  }

  transcribeChunk(chunk: AudioChunk, opts: TranscribeOptions): Promise<ChunkResult> {
    this.calls.push({ chunk, opts });
    if (opts.signal?.aborted) {
      return Promise.reject(new Error('Aborted'));
    }
    const step = this.script.shift() ?? defaultChunkResult(chunk);
    return step instanceof Error ? Promise.reject(step) : Promise.resolve(step);
  }
}
