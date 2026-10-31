/**
 * Whisper reads its prompt as preceding text and copies spellings from it, so a short glossary
 * steers acronyms and names (RAG, not RAC). Groq limits the prompt to 224 tokens; 400
 * characters stays well under that even for token-heavy acronyms.
 */
export const MAX_STT_PROMPT_LENGTH = 400;

/**
 * The STT prompt hint for a vocabulary, or undefined when there is none. Terms that would
 * overflow the limit are left out rather than cut in half.
 */
export function buildSttPrompt(vocabulary: readonly string[]): string | undefined {
  const prefix = 'Glossary: ';
  let hint = '';
  for (const term of vocabulary) {
    const next = hint === '' ? term : `${hint}, ${term}`;
    if (prefix.length + next.length + 1 > MAX_STT_PROMPT_LENGTH) break;
    hint = next;
  }
  return hint === '' ? undefined : `${prefix}${hint}.`;
}
