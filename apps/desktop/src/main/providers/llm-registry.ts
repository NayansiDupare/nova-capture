import type { LLMProvider, LlmProviderId } from '@nova/core';

import { GeminiLlmProvider } from './gemini-llm';
import type { SecretStore } from '../secrets/secret-store';

type Secrets = Pick<SecretStore, 'reveal'>;

/** One factory per provider id; adding an id to settings fails to compile until it is here. */
const FACTORIES: Record<LlmProviderId, (secrets: Secrets) => LLMProvider> = {
  gemini: (secrets) => new GeminiLlmProvider({ getApiKey: () => secrets.reveal('gemini') }),
};

/** Selects the LLM provider from settings (ARCHITECTURE.md §9). */
export function createLlmProvider(id: LlmProviderId, secrets: Secrets): LLMProvider {
  return FACTORIES[id](secrets);
}
