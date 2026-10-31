import type { DatabaseSync } from 'node:sqlite';

import { z } from 'zod';

import { KeyPointSchema, NoteModeSchema } from '@nova/core';
import type {
  KeyPoint,
  NoteContent,
  NoteListQuery,
  NoteSearchHit,
  NoteSearchQuery,
  NoteSummary,
  SavedNote,
  TranscriptSegment,
} from '@nova/core';

import { toFtsQuery } from './fts-query';
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

export type NoteRecord = Omit<SavedNote, 'segments'> & {
  readonly segments: TranscriptSegment[];
};

/** The fields of a saved note the user can edit. */
export type NoteContentEdit = {
  readonly title: string;
  readonly summary: string;
  readonly keyPoints: readonly KeyPoint[];
  readonly tags: readonly string[];
};

const SummaryRowSchema = z.object({
  id: z.string(),
  mode: NoteModeSchema,
  title: z.string(),
  summary: z.string(),
  favorite: z.number(),
  source_app: z.string().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
});

const NoteRowSchema = SummaryRowSchema.extend({
  session_id: z.string().nullable(),
  key_points: z.string(),
  language: z.string().nullable(),
  ai_model: z.string().nullable(),
  prompt_version: z.string().nullable(),
  stt_provider: z.string().nullable(),
  uncertain_terms: z.string().nullable(),
});

const SegmentRowSchema = z.object({
  start_ms: z.number(),
  end_ms: z.number(),
  text: z.string(),
  confidence: z.number().nullable(),
});

const SearchRowSchema = z.object({ note_id: z.string(), snippet: z.string() });

const SUMMARY_COLUMNS =
  'n.id, n.mode, n.title, n.summary, n.favorite, s.source_app, n.created_at, n.updated_at';
const NOTES_WITH_SESSION = 'notes n LEFT JOIN sessions s ON s.id = n.session_id';

/**
 * The rowid of a note's FTS row. `WHERE note_id = ?` on notes_fts itself loads every transcript,
 * so this reads FTS5's content table instead, where note_id is the first column (c0).
 */
const FTS_ROW_OF_NOTE = '(SELECT id FROM notes_fts_content WHERE c0 = ?)';

/** Plain transcript text: one segment per line. Stored on the note and indexed for search. */
function transcriptText(segments: readonly TranscriptSegment[]): string {
  return segments.map((s) => s.text).join('\n');
}

/** Key point text as the search index holds it. */
function keyPointText(keyPoints: readonly Pick<KeyPoint, 'text'>[]): string {
  return keyPoints.map((p) => p.text).join('\n');
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

      this.linkTags(note.id, content.tags);

      this.db
        .prepare(
          `INSERT INTO notes_fts (note_id, title, summary, key_points, tags, transcript)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          note.id,
          content.title,
          content.summary,
          keyPointText(content.keyPoints),
          content.tags.join(' '),
          transcript,
        );
    });
  }

  get(id: string): NoteRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT ${SUMMARY_COLUMNS}, n.session_id, n.key_points, n.language, n.ai_model,
           n.prompt_version, n.stt_provider, n.uncertain_terms
         FROM ${NOTES_WITH_SESSION} WHERE n.id = ? AND n.deleted_at IS NULL`,
      )
      .get(id);
    if (!row) return undefined;
    const parsed = NoteRowSchema.parse(row);
    return {
      ...this.toSummary(parsed),
      sessionId: parsed.session_id,
      keyPoints: z.array(KeyPointSchema).parse(JSON.parse(parsed.key_points)),
      language: parsed.language,
      uncertainTerms:
        parsed.uncertain_terms === null
          ? []
          : z.array(z.string()).parse(JSON.parse(parsed.uncertain_terms)),
      segments: this.segmentsOf(parsed.id),
      aiModel: parsed.ai_model,
      promptVersion: parsed.prompt_version,
      sttProvider: parsed.stt_provider,
    };
  }

  /** One page of notes, newest first. */
  list({ limit, offset, favoritesOnly, tag }: NoteListQuery): {
    notes: NoteSummary[];
    hasMore: boolean;
  } {
    // Literal conditions: `n.favorite = 1` is what lets SQLite use the notes_favorites index.
    const favorites = favoritesOnly ? 'AND n.favorite = 1' : '';
    const tagged =
      tag === undefined
        ? ''
        : `AND n.id IN (SELECT nt.note_id FROM note_tags nt JOIN tags t ON t.id = nt.tag_id
             WHERE t.name = ?)`;
    const rows = this.db
      .prepare(
        `SELECT ${SUMMARY_COLUMNS} FROM ${NOTES_WITH_SESSION}
         WHERE n.deleted_at IS NULL ${favorites} ${tagged}
         ORDER BY n.created_at DESC, n.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...(tag === undefined ? [] : [tag]), limit + 1, offset);
    return {
      notes: rows.slice(0, limit).map((row) => this.toSummary(SummaryRowSchema.parse(row))),
      hasMore: rows.length > limit,
    };
  }

  /**
   * One page of notes matching what the user typed, best match first. A match in the title
   * counts most and one in the transcript least, because a long transcript mentions a lot in
   * passing. The weights follow the column order of notes_fts. `ORDER BY rank` lets FTS5 sort
   * first, so a snippet is built only for the rows returned, not for every match.
   */
  search({ query, limit, offset }: NoteSearchQuery): {
    notes: NoteSearchHit[];
    hasMore: boolean;
  } {
    const match = toFtsQuery(query);
    if (match === null) return { notes: [], hasMore: false };
    const rows = this.db
      .prepare(
        `SELECT note_id, snippet(notes_fts, -1, '', '', '…', 16) AS snippet FROM notes_fts
         WHERE notes_fts MATCH ? AND rank MATCH 'bm25(0, 10, 5, 5, 5, 1)'
         ORDER BY rank LIMIT ? OFFSET ?`,
      )
      .all(match, limit + 1, offset);
    return {
      notes: rows.slice(0, limit).flatMap((row) => {
        const { note_id: noteId, snippet } = SearchRowSchema.parse(row);
        const summary = this.summaryOf(noteId);
        return summary ? [{ ...summary, snippet }] : [];
      }),
      hasMore: rows.length > limit,
    };
  }

  /**
   * Replaces a note's editable content and its search entry in one transaction. The
   * transcript never changes. Joins the caller's transaction if there is one.
   */
  update(id: string, edit: NoteContentEdit, now: number): void {
    inTransaction(this.db, () => {
      this.db
        .prepare(
          'UPDATE notes SET title = ?, summary = ?, key_points = ?, updated_at = ? WHERE id = ?',
        )
        .run(edit.title, edit.summary, JSON.stringify(edit.keyPoints), now, id);
      this.db.prepare('DELETE FROM note_tags WHERE note_id = ?').run(id);
      this.linkTags(id, edit.tags);
      this.removeUnusedTags();
      this.db
        .prepare(
          `UPDATE notes_fts SET title = ?, summary = ?, key_points = ?, tags = ?
           WHERE rowid = ${FTS_ROW_OF_NOTE}`,
        )
        .run(edit.title, edit.summary, keyPointText(edit.keyPoints), edit.tags.join(' '), id);
    });
  }

  /** Marks or unmarks a favorite. Not an edit, so `updatedAt` stays. */
  setFavorite(id: string, favorite: boolean): void {
    this.db.prepare('UPDATE notes SET favorite = ? WHERE id = ?').run(favorite ? 1 : 0, id);
  }

  /**
   * Removes a note with its segments, tags and FTS row in one transaction. Joins the caller's
   * transaction if there is one.
   */
  delete(id: string): void {
    inTransaction(this.db, () => {
      this.db.prepare(`DELETE FROM notes_fts WHERE rowid = ${FTS_ROW_OF_NOTE}`).run(id);
      this.db.prepare('DELETE FROM note_tags WHERE note_id = ?').run(id);
      // Its segments go with it (ON DELETE CASCADE).
      this.db.prepare('DELETE FROM notes WHERE id = ?').run(id);
      this.removeUnusedTags();
    });
  }

  /** The id of the note saved from `sessionId`, if any. */
  idForSession(sessionId: string): string | undefined {
    const row = this.db.prepare('SELECT id FROM notes WHERE session_id = ?').get(sessionId);
    return typeof row?.['id'] === 'string' ? row['id'] : undefined;
  }

  private summaryOf(id: string): NoteSummary | undefined {
    const row = this.db
      .prepare(
        `SELECT ${SUMMARY_COLUMNS} FROM ${NOTES_WITH_SESSION}
         WHERE n.id = ? AND n.deleted_at IS NULL`,
      )
      .get(id);
    return row ? this.toSummary(SummaryRowSchema.parse(row)) : undefined;
  }

  private toSummary(row: z.infer<typeof SummaryRowSchema>): NoteSummary {
    return {
      id: row.id,
      mode: row.mode,
      title: row.title,
      summary: row.summary,
      tags: this.tagsOf(row.id),
      favorite: row.favorite === 1,
      sourceApp: row.source_app,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private linkTags(noteId: string, tags: readonly string[]): void {
    const insertTag = this.db.prepare('INSERT INTO tags (name) VALUES (?) ON CONFLICT DO NOTHING');
    const linkTag = this.db.prepare(
      'INSERT INTO note_tags (note_id, tag_id) SELECT ?, id FROM tags WHERE name = ?',
    );
    for (const tag of tags) {
      insertTag.run(tag);
      linkTag.run(noteId, tag);
    }
  }

  private removeUnusedTags(): void {
    this.db
      .prepare(
        'DELETE FROM tags WHERE NOT EXISTS (SELECT 1 FROM note_tags nt WHERE nt.tag_id = tags.id)',
      )
      .run();
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

  private segmentsOf(noteId: string): TranscriptSegment[] {
    return this.db
      .prepare(
        'SELECT start_ms, end_ms, text, confidence FROM segments WHERE note_id = ? ORDER BY id',
      )
      .all(noteId)
      .map((row) => {
        const { start_ms: startMs, end_ms: endMs, text, confidence } = SegmentRowSchema.parse(row);
        return confidence === null
          ? { startMs, endMs, text }
          : { startMs, endMs, text, confidence };
      });
  }
}
