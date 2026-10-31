import type { DatabaseSync } from 'node:sqlite';

import { z } from 'zod';

import { NoteContentSchema } from '@nova/core';
import type { NoteDraft } from '@nova/core';

const RowSchema = z.object({
  session_id: z.string(),
  content: z.string(),
  ai_model: z.string(),
  prompt_version: z.string(),
  created_at: z.number(),
});

/**
 * Generated notes waiting for review, one per session. Kept until the note is saved, so a
 * crash or restart in REVIEW never costs a second LLM call. Content is transcript-derived:
 * never log it.
 */
export class NoteDraftsRepo {
  constructor(private readonly db: DatabaseSync) {}

  /** Stores a draft. An existing draft is kept: generation already succeeded once. */
  save(draft: NoteDraft): void {
    this.db
      .prepare(
        `INSERT INTO note_drafts (session_id, content, ai_model, prompt_version, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO NOTHING`,
      )
      .run(
        draft.sessionId,
        JSON.stringify(draft.content),
        draft.aiModel,
        draft.promptVersion,
        draft.createdAt,
      );
  }

  get(sessionId: string): NoteDraft | undefined {
    const row = this.db
      .prepare(
        `SELECT session_id, content, ai_model, prompt_version, created_at FROM note_drafts
         WHERE session_id = ?`,
      )
      .get(sessionId);
    if (!row) return undefined;
    const parsed = RowSchema.parse(row);
    return {
      sessionId: parsed.session_id,
      content: NoteContentSchema.parse(JSON.parse(parsed.content)),
      aiModel: parsed.ai_model,
      promptVersion: parsed.prompt_version,
      createdAt: parsed.created_at,
    };
  }

  /** Called inside the save transaction, once the note row exists. */
  delete(sessionId: string): void {
    this.db.prepare('DELETE FROM note_drafts WHERE session_id = ?').run(sessionId);
  }
}
