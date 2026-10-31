import type { DatabaseSync } from 'node:sqlite';

import { assembleTranscript, groundKeyPoints, NoteContentSchema, normalizeTags } from '@nova/core';
import type { NoteEdits } from '@nova/core';

import type { NoteDraftsRepo } from '../db/note-drafts-repo';
import type { NotesRepo } from '../db/notes-repo';
import type { SessionRecord, SessionsRepo } from '../db/sessions-repo';
import { inTransaction } from '../db/transaction';
import type { TranscriptChunksRepo } from '../db/transcript-chunks-repo';

export class NoDraftError extends Error {
  constructor(readonly sessionId: string) {
    super('This session has no note to save.');
    this.name = 'NoDraftError';
  }
}

export type SaveNote = (
  sessionId: string,
  edits: NoteEdits,
) => { noteId: string; session: SessionRecord };

/**
 * Saves a reviewed note: the user's edits on top of the stored draft. Mode, language, model
 * and prompt version always come from the draft. Key points are ground-checked again because
 * their text may have changed. The note, its search entry and the session's move to SAVED
 * commit together; if the session is not in REVIEW, nothing is written.
 */
export function createNoteSaver(deps: {
  db: DatabaseSync;
  sessions: SessionsRepo;
  drafts: NoteDraftsRepo;
  notes: NotesRepo;
  chunks: TranscriptChunksRepo;
  newId: () => string;
  now: () => number;
  getVocabulary?: () => readonly string[];
}): SaveNote {
  return (sessionId, edits) => {
    const draft = deps.drafts.get(sessionId);
    if (!draft) {
      throw new NoDraftError(sessionId);
    }
    const transcript = assembleTranscript(deps.chunks.listBySession(sessionId));
    const content = NoteContentSchema.parse({
      ...draft.content,
      title: edits.title.trim(),
      summary: edits.summary.trim(),
      keyPoints: groundKeyPoints(
        edits.keyPoints.map((p) => ({ ...p, text: p.text.trim() })),
        transcript,
        deps.getVocabulary?.() ?? [],
      ),
      tags: normalizeTags(edits.tags),
    });
    const noteId = deps.newId();

    return inTransaction(deps.db, () => {
      deps.notes.create({
        id: noteId,
        sessionId,
        content,
        transcript,
        aiModel: draft.aiModel,
        promptVersion: draft.promptVersion,
        sttProvider: deps.chunks.providers(sessionId).join(',') || null,
        now: deps.now(),
      });
      deps.drafts.delete(sessionId);
      // Throws InvalidTransitionError outside REVIEW, which rolls the note back.
      const session = deps.sessions.transition(sessionId, { type: 'save' });
      return { noteId, session };
    });
  };
}
