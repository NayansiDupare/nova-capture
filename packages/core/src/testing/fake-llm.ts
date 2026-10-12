import { InvalidOutputError } from '../providers/providers';
import type { LLMProvider, LlmUsage, StructuredRequest } from '../providers/providers';

/** One scripted reply: raw model output (validated like a real provider would), or an error to throw. */
export type FakeLlmStep = { output: unknown } | Error;

export const FAKE_LLM_USAGE: LlmUsage = { inputTokens: 100, outputTokens: 50, costEstimateUsd: 0 };

/**
 * Test double for {@link LLMProvider}. Replies follow `script` in order; a call with
 * nothing left in the script fails, so tests always state what the model returns.
 * Output that does not match the request schema throws {@link InvalidOutputError}.
 */
export class FakeLLM implements LLMProvider {
  readonly id = 'fake-llm';
  readonly calls: StructuredRequest<unknown>[] = [];
  private readonly script: FakeLlmStep[];

  constructor(script: readonly FakeLlmStep[]) {
    this.script = [...script];
  }

  generateStructured<T>(req: StructuredRequest<T>): Promise<{ data: T; usage: LlmUsage }> {
    this.calls.push(req);
    if (req.signal?.aborted) {
      return Promise.reject(new Error('Aborted'));
    }
    const step = this.script.shift();
    if (!step) {
      return Promise.reject(
        new Error(`FakeLLM has no scripted reply for call ${String(this.calls.length)}`),
      );
    }
    if (step instanceof Error) {
      return Promise.reject(step);
    }
    const parsed = req.schema.safeParse(step.output);
    if (!parsed.success) {
      return Promise.reject(new InvalidOutputError(this.id, parsed.error.issues));
    }
    return Promise.resolve({ data: parsed.data, usage: FAKE_LLM_USAGE });
  }
}
