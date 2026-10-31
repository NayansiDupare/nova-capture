import { groundKeyPoints } from './ground-check';
import { chooseNoteMode, NOTE_OUTPUT_SCHEMAS, toNoteContent } from './note';
import type { FullNoteOutput, NoteContent, NoteMode, QuickNoteOutput } from './note';
import type { NotePrompt } from '../prompts/note-prompt';
import {
  buildNotePrompt,
  buildRepairPrompt,
  describeIssues,
  NOTE_MAX_OUTPUT_TOKENS,
  NOTE_PROMPT_VERSION,
} from '../prompts/note-prompt';
import type {
  CancelSignal,
  LLMProvider,
  LlmUsage,
  TranscriptSegment,
} from '../providers/providers';
import { InvalidOutputError } from '../providers/providers';

export type GeneratedNote = {
  readonly content: NoteContent;
  readonly aiModel: string;
  readonly promptVersion: string;
};

export type GenerateNoteInput = {
  readonly segments: readonly TranscriptSegment[];
  /** Defaults to {@link chooseNoteMode}. */
  readonly mode?: NoteMode;
  /** The user's spelling of expected terms (ADR 0006). */
  readonly vocabulary?: readonly string[];
  /** Called after every billed call, including ones whose output was invalid. */
  readonly onUsage?: (usage: LlmUsage) => void;
  readonly signal?: CancelSignal;
};

/**
 * Writes a note from a transcript (ARCHITECTURE.md §9): one call with the versioned prompt,
 * validated against the mode's schema. If the output is invalid, one repair call includes the
 * validation problems; if that fails too, the second {@link InvalidOutputError} is thrown.
 * Key points are ground-checked against the transcript before returning.
 */
export async function generateNote(
  llm: LLMProvider,
  input: GenerateNoteInput,
): Promise<GeneratedNote> {
  const mode = input.mode ?? chooseNoteMode(input.segments);
  const vocabulary = input.vocabulary ?? [];
  const prompt = buildNotePrompt(input.segments, mode, vocabulary);

  let output: { mode: 'full'; note: FullNoteOutput } | { mode: 'quick'; note: QuickNoteOutput };
  try {
    output = await call(llm, mode, prompt, input);
  } catch (error) {
    if (!(error instanceof InvalidOutputError)) throw error;
    output = await call(llm, mode, buildRepairPrompt(prompt, describeIssues(error.issues)), input);
  }

  const content = toNoteContent(output);
  return {
    content: {
      ...content,
      keyPoints: groundKeyPoints(content.keyPoints, input.segments, vocabulary),
    },
    aiModel: llm.model,
    promptVersion: NOTE_PROMPT_VERSION,
  };
}

async function call(
  llm: LLMProvider,
  mode: NoteMode,
  prompt: NotePrompt,
  input: GenerateNoteInput,
): Promise<{ mode: 'full'; note: FullNoteOutput } | { mode: 'quick'; note: QuickNoteOutput }> {
  const request = {
    ...prompt,
    maxTokens: NOTE_MAX_OUTPUT_TOKENS,
    ...(input.signal ? { signal: input.signal } : {}),
  };
  try {
    if (mode === 'full') {
      const { data, usage } = await llm.generateStructured({
        ...request,
        schema: NOTE_OUTPUT_SCHEMAS.full,
      });
      input.onUsage?.(usage);
      return { mode, note: data };
    }
    const { data, usage } = await llm.generateStructured({
      ...request,
      schema: NOTE_OUTPUT_SCHEMAS.quick,
    });
    input.onUsage?.(usage);
    return { mode, note: data };
  } catch (error) {
    if (error instanceof InvalidOutputError && error.usage) input.onUsage?.(error.usage);
    throw error;
  }
}
