import { rm } from 'node:fs/promises';
import type { DatabaseSync } from 'node:sqlite';

import { groundKeyPoints, normalizeTags } from '@nova/core';
import type { NoteChanges, NoteListQuery, NoteSearchQuery } from '@nova/core';

import type { NoteRecord, NotesRepo } from '../db/notes-repo';
import type { SessionsRepo } from '../db/sessions-repo';
import { inTransaction } from '../db/transaction';
import type { TranscriptChunksRepo } from '../db/transcript-chunks-repo';

export class NoteNotFoundError extends Error {
  constructor(readonly noteId: string) {
    super('This note no longer exists.');
    this.name = 'NoteNotFoundError';
  }
}

/** What the Library and Note detail screens can do with saved notes. */
export type NoteLibrary = {
  list(query: NoteListQuery): ReturnType<NotesRepo['list']>;
  get(noteId: string): NoteRecord | null;
  search(query: NoteSearchQuery): ReturnType<NotesRepo['search']>;
  update(noteId: string, changes: NoteChanges): NoteRecord;
  delete(noteId: string): Promise<void>;
};

export function createNoteLibrary(deps: {
  db: DatabaseSync;
  notes: NotesRepo;
  sessions: SessionsRepo;
  chunks: TranscriptChunksRepo;
  now: () => number;
  getVocabulary: () => readonly string[];
}): NoteLibrary {
  const { db, notes, sessions, chunks } = deps;

  const requireNote = (noteId: string): NoteRecord => {
    const note = notes.get(noteId);
    if (!note) {
      throw new NoteNotFoundError(noteId);
    }
    return note;
  };

  return {
    list: (query) => notes.list(query),
    get: (noteId) => notes.get(noteId) ?? null,
    search: (query) => notes.search(query),

    /**
     * Applies the user's changes on top of the stored note. Edited key points are ground-checked
     * again, as on save, because their text may have changed. All of it commits together.
     */
    update: (noteId, { favorite, ...edits }) =>
      inTransaction(db, () => {
        const note = requireNote(noteId);
        if (favorite !== undefined) {
          notes.setFavorite(noteId, favorite);
        }
        if (Object.values(edits).some((value) => value !== undefined)) {
          notes.update(
            noteId,
            {
              title: edits.title ?? note.title,
              summary: edits.summary ?? note.summary,
              keyPoints: edits.keyPoints
                ? groundKeyPoints(edits.keyPoints, note.segments, deps.getVocabulary())
                : note.keyPoints,
              tags: edits.tags ? normalizeTags(edits.tags) : note.tags,
            },
            deps.now(),
          );
        }
        return requireNote(noteId);
      }),

    /**
     * Permanently removes a note and what it was made from (SECURITY.md §6). The transcript
     * chunks hold the same text as the note, so they go too. The audio goes first: if the file
     * cannot be removed the note stays and the user can retry, instead of leaving audio that
     * nothing points to. The note is already saved, so AGENTS.md §4.5 is not at risk.
     */
    delete: async (noteId) => {
      const sessionId = notes.get(noteId)?.sessionId;
      if (sessionId === undefined) return;
      const spoolPath = sessionId === null ? null : sessions.get(sessionId)?.spoolPath;
      if (spoolPath) {
        await rm(spoolPath, { force: true });
      }
      inTransaction(db, () => {
        notes.delete(noteId);
        if (sessionId !== null) {
          chunks.deleteBySession(sessionId);
        }
      });
    },
  };
}
