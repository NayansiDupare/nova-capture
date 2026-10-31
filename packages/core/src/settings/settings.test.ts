import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SETTINGS,
  MAX_VOCABULARY_TERMS,
  parseVocabulary,
  SECRET_IDS,
  SettingsPatchSchema,
  SettingsSchema,
} from './settings';

describe('settings', () => {
  it('has valid defaults', () => {
    expect(SettingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  it('needs a secret for every STT and LLM provider', () => {
    expect(SECRET_IDS).toEqual(['deepgram', 'groq', 'gemini']);
  });

  it('accepts a vocabulary patch and rejects blank or oversized terms', () => {
    expect(SettingsPatchSchema.safeParse({ vocabulary: ['RAG', 'LangChain'] }).success).toBe(true);
    expect(SettingsPatchSchema.safeParse({ vocabulary: ['  '] }).success).toBe(false);
    expect(SettingsPatchSchema.safeParse({ vocabulary: ['x'.repeat(61)] }).success).toBe(false);
    const tooMany = Array.from({ length: MAX_VOCABULARY_TERMS + 1 }, (_, i) => `t${String(i)}`);
    expect(SettingsPatchSchema.safeParse({ vocabulary: tooMany }).success).toBe(false);
  });
});

describe('parseVocabulary', () => {
  it('splits on commas and new lines, trims, and keeps the first spelling of duplicates', () => {
    expect(parseVocabulary(' RAG, LangChain\nrag,, embeddings \n')).toEqual([
      'RAG',
      'LangChain',
      'embeddings',
    ]);
  });

  it('caps the number of terms', () => {
    const text = Array.from({ length: 150 }, (_, i) => `t${String(i)}`).join(',');
    expect(parseVocabulary(text)).toHaveLength(MAX_VOCABULARY_TERMS);
  });
});
