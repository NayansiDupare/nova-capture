import { ProviderError } from '@nova/core';
import type { SpeechToTextProvider, SttProviderId } from '@nova/core';

import { GroqSttProvider } from './groq-stt';
import type { SecretStore } from '../secrets/secret-store';

/** Selects the STT provider from settings (ARCHITECTURE.md §7 "provider registry"). */
export function createSttProvider(
  id: SttProviderId,
  secrets: Pick<SecretStore, 'reveal'>,
): SpeechToTextProvider {
  switch (id) {
    case 'groq':
      return new GroqSttProvider({ getApiKey: () => secrets.reveal('groq') });
    case 'deepgram':
      return unsupported('deepgram');
    default: {
      const _exhaustive: never = id;
      throw new Error(`Unknown STT provider: ${String(_exhaustive)}`);
    }
  }
}

/** Deepgram is a P2 comparison provider (PRD.md FR-19); until it is built, fail clearly. */
function unsupported(id: string): SpeechToTextProvider {
  return {
    id,
    capabilities: { streaming: false, maxChunkSec: 0, languages: 'auto', wordTimestamps: false },
    transcribeChunk: () =>
      Promise.reject(
        new ProviderError(`${id} is not supported yet. Choose Groq in Settings.`, id, false),
      ),
  };
}
