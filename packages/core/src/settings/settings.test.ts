import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, SECRET_IDS, SettingsSchema } from './settings';

describe('settings', () => {
  it('has valid defaults', () => {
    expect(SettingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  it('needs a secret for every STT and LLM provider', () => {
    expect(SECRET_IDS).toEqual(['deepgram', 'groq', 'gemini']);
  });
});
