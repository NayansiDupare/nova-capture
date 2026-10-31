import { describe, expect, it } from 'vitest';

import { buildSttPrompt, MAX_STT_PROMPT_LENGTH } from './stt-prompt';

describe('buildSttPrompt', () => {
  it('lists the vocabulary as a glossary', () => {
    expect(buildSttPrompt(['RAG', 'LangChain'])).toBe('Glossary: RAG, LangChain.');
  });

  it('is undefined without vocabulary', () => {
    expect(buildSttPrompt([])).toBeUndefined();
  });

  it('stays under the limit by leaving out whole terms', () => {
    const terms = Array.from({ length: 100 }, (_, i) => `Term${String(i)}`);
    const prompt = buildSttPrompt(terms) ?? '';
    expect(prompt.length).toBeLessThanOrEqual(MAX_STT_PROMPT_LENGTH);
    expect(prompt).toMatch(/^Glossary: Term0, Term1, .*Term\d+\.$/u);
  });
});
