import type { DatabaseSync } from 'node:sqlite';

import { z } from 'zod';

import { KeyPointSchema, NoteModeSchema } from '@nova/core';
import type { KeyPoint, NoteContent, NoteMode, TranscriptSegment } from '@nova/core';

import { inTransaction } from './transaction';

export type NewNote = {
  readonly id: string;
  readonly sessionId: string;
  readonly content: NoteContent;
  readonly transcript: readonly TranscriptSegment[];
  readonly aiModel: string;
  readonly promptVersion: string;
  readonly sttProvider: string | null;
  readonly now: number;
};

export type NoteRecord = {
  readonly id: string;
  readonly sessionId: string | null;
  readonly mode: NoteMode;
  readonly title: string;
  readonly summary: string;
  readonly keyPoints: KeyPoint[];
  readonly tags: string[];
  readonly language: string | null;
  readonly uncertainTerms: string[];
  readonly transcript: string;
  readonly aiModel: string | null;
  readonly promptVersion: string | null;
  readonly sttProvider: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
};

const NoteRowSchema = z.object({
  id: z.string(),
  session_id: z.string().nullable(),
  mode: NoteModeSchema,
  title: z.string(),
  summary: z.string(),
  key_points: z.string(),
  transcript: z.string(),
  language: z.string().nullable(),
  ai_model: z.string().nullable(),
  prompt_version: z.string().nullable(),
  stt_provider: z.string().nullable(),
  uncertain_terms: z.string().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
});

/** Plain transcript text: one segment per line. Stored on the note and indexed for search. */
export function transcriptText(segments: readonly TranscriptSegment[]): string {
  return segments.map((s) => s.text).join('\n');
}

/**
 * Saved notes (ARCHITECTURE.md §10). A note, its segments, its tags and its FTS row are
 * written in one transaction, so search never sees a half-saved note. Note and transcript
 * text must never be logged.
 */
export class NotesRepo {
  constructor(private readonly db: DatabaseSync) {}

  /** Inserts a note. Joins the caller's transaction if there is one. */
  create(note: NewNote): void {
    const { content } = note;
    const transcript = transcriptText(note.transcript);
    inTransaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO notes (id, session_id, mode, title, summary, key_points, transcript,
             language, ai_model, prompt_version, stt_provider, uncertain_terms, created_at,
             updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          note.id,
          note.sessionId,
          content.mode,
          content.title,
          content.summary,
          JSON.stringify(content.keyPoints),
          transcript,
          content.language,
          note.aiModel,
          note.promptVersion,
          note.sttProvider,
          JSON.stringify(content.uncertainTerms),
          note.now,
          note.now,
        );

      const insertSegment = this.db.prepare(
        'INSERT INTO segments (note_id, start_ms, end_ms, text, confidence) VALUES (?, ?, ?, ?, ?)',
      );
      for (const s of note.transcript) {
        insertSegment.run(note.id, s.startMs, s.endMs, s.text, s.confidence ?? null);
      }

      const insertTag = this.db.prepare(
        'INSERT INTO tags (name) VALUES (?) ON CONFLICT DO NOTHING',
      );
      const linkTag = this.db.prepare(
        'INSERT INTO note_tags (note_id, tag_id) SELECT ?, id FROM tags WHERE name = ?',
      );
      for (const tag of content.tags) {
        insertTag.run(tag);
        linkTag.run(note.id, tag);
      }

      this.db
        .prepare(
          `INSERT INTO notes_fts (note_id, title, summary, key_points, tags, transcript)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          note.id,
          content.title,
          content.summary,
          content.keyPoints.map((p) => p.text).join('\n'),
          content.tags.join(' '),
          transcript,
        );
    });
  }

  get(id: string): NoteRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT id, session_id, mode, title, summary, key_points, transcript, language, ai_model,
           prompt_version, stt_provider, uncertain_terms, created_at, updated_at
         FROM notes WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(id);
    if (!row) return undefined;
    const parsed = NoteRowSchema.parse(row);
    return {
      id: parsed.id,
      sessionId: parsed.session_id,
      mode: parsed.mode,
      title: parsed.title,
      summary: parsed.summary,
      keyPoints: z.array(KeyPointSchema).parse(JSON.parse(parsed.key_points)),
      tags: this.tagsOf(parsed.id),
      language: parsed.language,
      uncertainTerms:
        parsed.uncertain_terms === null
          ? []
          : z.array(z.string()).parse(JSON.parse(parsed.uncertain_terms)),
      transcript: parsed.transcript,
      aiModel: parsed.ai_model,
      promptVersion: parsed.prompt_version,
      sttProvider: parsed.stt_provider,
      createdAt: parsed.created_at,
      updatedAt: parsed.updated_at,
    };
  }

  /** The id of the note saved from `sessionId`, if any. */
  idForSession(sessionId: string): string | undefined {
    const row = this.db.prepare('SELECT id FROM notes WHERE session_id = ?').get(sessionId);
    return typeof row?.['id'] === 'string' ? row['id'] : undefined;
  }

  private tagsOf(noteId: string): string[] {
    return this.db
      .prepare(
        `SELECT t.name FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
         WHERE nt.note_id = ? ORDER BY t.name`,
      )
      .all(noteId)
      .map((row) => String(row['name']));
  }
}
