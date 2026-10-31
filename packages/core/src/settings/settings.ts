import { z } from 'zod';

/** STT providers compared in the Phase 0 spike (PRD.md §12). */
export const STT_PROVIDER_IDS = ['deepgram', 'groq'] as const;
export const SttProviderIdSchema = z.enum(STT_PROVIDER_IDS);
export type SttProviderId = z.infer<typeof SttProviderIdSchema>;

export const LLM_PROVIDER_IDS = ['gemini'] as const;
export const LlmProviderIdSchema = z.enum(LLM_PROVIDER_IDS);
export type LlmProviderId = z.infer<typeof LlmProviderIdSchema>;

export const MAX_VOCABULARY_TERMS = 100;
export const MAX_VOCABULARY_TERM_LENGTH = 60;

/**
 * Terms the user expects to hear (RAG, LangChain, Nyquist). Sent to STT as a spelling hint and
 * to the LLM, which uses this spelling when the transcript has a near-miss (ADR 0006).
 */
export const VocabularySchema = z
  .array(z.string().trim().min(1).max(MAX_VOCABULARY_TERM_LENGTH))
  .max(MAX_VOCABULARY_TERMS);

/** User settings. Secrets are not settings: they live in the secret store (SECURITY.md §5). */
export const SettingsSchema = z.strictObject({
  sttProvider: SttProviderIdSchema,
  llmProvider: LlmProviderIdSchema,
  vocabulary: VocabularySchema,
});
export type Settings = z.infer<typeof SettingsSchema>;

/** A partial update. Unknown keys are rejected so typos never pass silently. */
export const SettingsPatchSchema = SettingsSchema.partial();
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export const DEFAULT_SETTINGS: Settings = {
  // Provisional: the Phase 0 comparison has not picked a default yet (PRD.md §12).
  sttProvider: 'groq',
  llmProvider: 'gemini',
  vocabulary: [],
};

/**
 * Splits free text (commas or new lines) into vocabulary terms: trimmed, de-duplicated
 * ignoring case (the first spelling wins), capped at the schema limits.
 */
export function parseVocabulary(text: string): string[] {
  const seen = new Map<string, string>();
  for (const raw of text.split(/[,\n]/u)) {
    const term = raw.trim().slice(0, MAX_VOCABULARY_TERM_LENGTH);
    if (term !== '' && !seen.has(term.toLowerCase())) seen.set(term.toLowerCase(), term);
  }
  return [...seen.values()].slice(0, MAX_VOCABULARY_TERMS);
}

/** Providers that need an API key. */
export const SECRET_IDS = [...STT_PROVIDER_IDS, ...LLM_PROVIDER_IDS] as const;
export const SecretIdSchema = z.enum(SECRET_IDS);
export type SecretId = z.infer<typeof SecretIdSchema>;
