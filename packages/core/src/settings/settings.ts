import { z } from 'zod';

/** STT providers compared in the Phase 0 spike (PRD.md §12). */
export const STT_PROVIDER_IDS = ['deepgram', 'groq'] as const;
export const SttProviderIdSchema = z.enum(STT_PROVIDER_IDS);
export type SttProviderId = z.infer<typeof SttProviderIdSchema>;

export const LLM_PROVIDER_IDS = ['gemini'] as const;
export const LlmProviderIdSchema = z.enum(LLM_PROVIDER_IDS);
export type LlmProviderId = z.infer<typeof LlmProviderIdSchema>;

/** User settings. Secrets are not settings: they live in the secret store (SECURITY.md §5). */
export const SettingsSchema = z.strictObject({
  sttProvider: SttProviderIdSchema,
  llmProvider: LlmProviderIdSchema,
});
export type Settings = z.infer<typeof SettingsSchema>;

/** A partial update. Unknown keys are rejected so typos never pass silently. */
export const SettingsPatchSchema = SettingsSchema.partial();
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export const DEFAULT_SETTINGS: Settings = {
  // Provisional: the Phase 0 comparison has not picked a default yet (PRD.md §12).
  sttProvider: 'groq',
  llmProvider: 'gemini',
};

/** Providers that need an API key. */
export const SECRET_IDS = [...STT_PROVIDER_IDS, ...LLM_PROVIDER_IDS] as const;
export const SecretIdSchema = z.enum(SECRET_IDS);
export type SecretId = z.infer<typeof SecretIdSchema>;
