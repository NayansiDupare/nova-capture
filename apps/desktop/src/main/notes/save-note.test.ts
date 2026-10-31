import { describe, expect, it } from 'vitest';

import { InvalidTransitionError } from '@nova/core';
import type { NoteDraft, NoteEdits } from '@nova/core';

import { createNoteSaver, NoDraftError } from './save-note';
import { NoteDraftsRepo } from '../db/note-drafts-repo';
import { NotesRepo } from '../db/notes-repo';
import { openDatabase } from '../db/open-database';
import { SessionsRepo } from '../db/sessions-repo';
import { TranscriptChunksRepo } from '../db/transcript-chunks-repo';

const DRAFT: NoteDraft = {
  sessionId: 's1',
  content: {
    mode: 'full',
    title: 'Generated title',
    summary: 'Generated summary.',
    keyPoints: [{ text: 'Generated point.', startMs: 0, endMs: 4000, flags: [] }],
    tags: ['math'],
    language: 'en',
    uncertainTerms: ['Nyquist'],
  },
  aiModel: 'gemini-3.8-flash',
  promptVersion: 'note-v1',
  createdAt: 1,
};

const EDITS: NoteEdits = {
  title: ' Edited title ',
  summary: 'Edited summary.',
  keyPoints: [
    { text: 'About the "Fourier transform".', startMs: 0, endMs: 4000 },
    { text: 'Mentions "Laplace".', startMs: 0, endMs: 4000 },
  ],
  tags: ['Signal Processing'],
};

const setup = (state = 'REVIEW', vocabulary: readonly string[] = []) => {
  const db = openDatabase(':memory:');
  db.prepare('INSERT INTO sessions (id, state, started_at) VALUES (?, ?, 1)').run('s1', state);
  const sessions = new SessionsRepo(db);
  const drafts = new NoteDraftsRepo(db);
  const notes = new NotesRepo(db);
  const chunks = new TranscriptChunksRepo(db);
  chunks.save('s1', 'groq', {
    chunk: { index: 0, startMs: 0, endMs: 30_000 },
    result: { segments: [{ startMs: 0, endMs: 4000, text: 'The Fourier transform.' }] },
  });
  drafts.save(DRAFT);
  const save = createNoteSaver({
    db,
    sessions,
    drafts,
    notes,
    chunks,
    newId: () => 'n1',
    now: () => 9,
    getVocabulary: () => vocabulary,
  });
  return { save, sessions, drafts, notes };
};

describe('createNoteSaver', () => {
  it('saves the edits on top of the draft and moves the session to SAVED', () => {
    const { save, drafts, notes } = setup();

    const { noteId, session } = save('s1', EDITS);

    expect(noteId).toBe('n1');
    expect(session.state).toBe('SAVED');
    expect(notes.get('n1')).toMatchObject({
      mode: 'full',
      title: 'Edited title',
      summary: 'Edited summary.',
      tags: ['signal-processing'],
      language: 'en',
      uncertainTerms: ['Nyquist'],
      aiModel: 'gemini-3.8-flash',
      promptVersion: 'note-v1',
      sttProvider: 'groq',
      segments: [{ startMs: 0, endMs: 4000, text: 'The Fourier transform.' }],
      createdAt: 9,
    });
    expect(drafts.get('s1')).toBeUndefined();
  });

  it('ground-checks the edited key points again', () => {
    const { save, notes } = setup();
    save('s1', EDITS);
    expect(notes.get('n1')?.keyPoints.map((p) => p.flags)).toEqual([[], ['quoted-term-missing']]);
  });

  it('does not flag quoted vocabulary terms that correct the transcript', () => {
    const { save, notes } = setup('REVIEW', ['Laplace']);
    save('s1', EDITS);
    expect(notes.get('n1')?.keyPoints.map((p) => p.flags)).toEqual([[], []]);
  });

  it('writes nothing when the session is not in REVIEW', () => {
    const { save, sessions, drafts, notes } = setup('GENERATING');
    expect(() => save('s1', EDITS)).toThrow(InvalidTransitionError);
    expect(notes.idForSession('s1')).toBeUndefined();
    expect(drafts.get('s1')).toBeDefined();
    expect(sessions.get('s1')?.state).toBe('GENERATING');
  });

  it('refuses a session without a draft', () => {
    const { save, drafts } = setup();
    drafts.delete('s1');
    expect(() => save('s1', EDITS)).toThrow(NoDraftError);
  });

  it('refuses a second save of the same session', () => {
    const { save } = setup();
    save('s1', EDITS);
    expect(() => save('s1', EDITS)).toThrow(NoDraftError);
  });
});
