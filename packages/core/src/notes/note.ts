import { z } from 'zod';

import type { TranscriptSegment } from '../providers/providers';

/** Quick Save for short captures, Full Note otherwise (ARCHITECTURE.md §9). */
export const NOTE_MODES = ['quick', 'full'] as const;
export const NoteModeSchema = z.enum(NOTE_MODES);
export type NoteMode = z.infer<typeof NoteModeSchema>;

/** Captures with less speech than this get a Quick Save (the spike's threshold, PRD.md FR-8). */
export const QUICK_MAX_SPEECH_MS = 120_000;

/** Total speaking time in a transcript, from its segment ranges. */
export function speechDurationMs(segments: readonly TranscriptSegment[]): number {
  return segments.reduce((sum, s) => sum + Math.max(0, s.endMs - s.startMs), 0);
}

export function chooseNoteMode(segments: readonly TranscriptSegment[]): NoteMode {
  return speechDurationMs(segments) < QUICK_MAX_SPEECH_MS ? 'quick' : 'full';
}

/*
 * What the LLM must return. Times are seconds because the prompt shows the transcript in
 * seconds. No transforms or refinements: these schemas are also sent to the provider as
 * JSON Schema, which cannot express them. Normalization happens in `toNoteContent`.
 */
export const FullNoteOutputSchema = z.object({
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  keyPoints: z
    .array(
      z.object({
        text: z.string().trim().min(1),
        startSec: z.number().nonnegative(),
        endSec: z.number().nonnegative(),
      }),
    )
    .min(1),
  tags: z.array(z.string()),
  language: z.string().trim().min(1),
  uncertainTerms: z.array(z.string()),
});
export type FullNoteOutput = z.infer<typeof FullNoteOutputSchema>;

export const QuickNoteOutputSchema = z.object({
  title: z.string().trim().min(1),
  gist: z.string().trim().min(1),
  tags: z.array(z.string()),
  language: z.string().trim().min(1),
});
export type QuickNoteOutput = z.infer<typeof QuickNoteOutputSchema>;

export const NOTE_OUTPUT_SCHEMAS = {
  full: FullNoteOutputSchema,
  quick: QuickNoteOutputSchema,
} as const;

/**
 * Why a key point may not be supported by the transcript (ARCHITECTURE.md §9 ground check).
 * - `time-range-not-in-transcript`: no transcript segment overlaps the point's time range.
 * - `quoted-term-missing`: a term the point quotes does not appear in the transcript.
 */
export const GROUNDING_FLAGS = ['time-range-not-in-transcript', 'quoted-term-missing'] as const;
export const GroundingFlagSchema = z.enum(GROUNDING_FLAGS);
export type GroundingFlag = z.infer<typeof GroundingFlagSchema>;

export const MAX_TITLE_LENGTH = 200;
export const MAX_SUMMARY_LENGTH = 5000;
export const MAX_KEY_POINT_LENGTH = 2000;
export const MAX_KEY_POINTS = 30;
export const MAX_TAGS = 12;
export const MAX_TAG_LENGTH = 40;

const TimeMsSchema = z.number().int().nonnegative();

/** A key point as the user edits it. Times are milliseconds from the session start. */
export const KeyPointEditSchema = z.strictObject({
  text: z.string().trim().min(1).max(MAX_KEY_POINT_LENGTH),
  startMs: TimeMsSchema,
  endMs: TimeMsSchema,
});
export type KeyPointEdit = z.infer<typeof KeyPointEditSchema>;

export const KeyPointSchema = KeyPointEditSchema.extend({
  flags: z.array(GroundingFlagSchema),
});
export type KeyPoint = z.infer<typeof KeyPointSchema>;

/**
 * A note's content in one shape for both modes. A Quick Save stores its gist as `summary`
 * and has no key points or uncertain terms.
 */
export const NoteContentSchema = z.strictObject({
  mode: NoteModeSchema,
  title: z.string().min(1).max(MAX_TITLE_LENGTH),
  summary: z.string().min(1).max(MAX_SUMMARY_LENGTH),
  keyPoints: z.array(KeyPointSchema).max(MAX_KEY_POINTS),
  tags: z.array(z.string().min(1).max(MAX_TAG_LENGTH)).max(MAX_TAGS),
  language: z.string(),
  uncertainTerms: z.array(z.string()),
});
export type NoteContent = z.infer<typeof NoteContentSchema>;

/** A generated note waiting for review. Model and prompt version are kept with the note (§9). */
export const NoteDraftSchema = z.strictObject({
  sessionId: z.string().min(1),
  content: NoteContentSchema,
  aiModel: z.string(),
  promptVersion: z.string(),
  createdAt: z.number(),
});
export type NoteDraft = z.infer<typeof NoteDraftSchema>;

/** The fields the Review screen can change. Mode, language and model come from the draft. */
export const NoteEditsSchema = z.strictObject({
  title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
  summary: z.string().trim().min(1).max(MAX_SUMMARY_LENGTH),
  keyPoints: z.array(KeyPointEditSchema).max(MAX_KEY_POINTS),
  tags: z.array(z.string().max(MAX_TAG_LENGTH)).max(MAX_TAGS),
});
export type NoteEdits = z.input<typeof NoteEditsSchema>;

/**
 * Lowercase, hyphenated tags with letters and digits only, de-duplicated and capped.
 * `Machine Learning` and `machine-learning` become the same tag.
 */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const tag of tags) {
    const normalized = tag
      .normalize('NFKC')
      .toLowerCase()
      .trim()
      .replace(/[\s_]+/gu, '-')
      .replace(/[^\p{L}\p{N}-]/gu, '')
      .replace(/-+/gu, '-')
      .replace(/^-|-$/gu, '')
      .slice(0, MAX_TAG_LENGTH);
    if (normalized !== '') seen.add(normalized);
  }
  return [...seen].slice(0, MAX_TAGS);
}

const clip = (text: string, max: number) => text.trim().slice(0, max);
const toMs = (sec: number) => Math.round(sec * 1000);

/** Converts validated LLM output into note content (without grounding flags yet). */
export function toNoteContent(
  output: { mode: 'full'; note: FullNoteOutput } | { mode: 'quick'; note: QuickNoteOutput },
): Omit<NoteContent, 'keyPoints'> & { keyPoints: KeyPointEdit[] } {
  const common = {
    title: clip(output.note.title, MAX_TITLE_LENGTH),
    tags: normalizeTags(output.note.tags),
    language: output.note.language.trim(),
  };
  if (output.mode === 'quick') {
    return {
      ...common,
      mode: 'quick',
      summary: clip(output.note.gist, MAX_SUMMARY_LENGTH),
      keyPoints: [],
      uncertainTerms: [],
    };
  }
  return {
    ...common,
    mode: 'full',
    summary: clip(output.note.summary, MAX_SUMMARY_LENGTH),
    keyPoints: output.note.keyPoints.slice(0, MAX_KEY_POINTS).map((point) => {
      // Models occasionally swap the ends of a range; the meaning is clear, so fix it.
      const [start, end] = [point.startSec, point.endSec].sort((a, b) => a - b) as [number, number];
      return {
        text: clip(point.text, MAX_KEY_POINT_LENGTH),
        startMs: toMs(start),
        endMs: toMs(end),
      };
    }),
    uncertainTerms: [...new Set(output.note.uncertainTerms.map((t) => t.trim()).filter((t) => t))],
  };
}
