import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { NoteContent } from '@nova/core';

import { createNoteLibrary, NoteNotFoundError } from './note-library';
import { NotesRepo } from '../db/notes-repo';
import { openDatabase } from '../db/open-database';
import { SessionsRepo } from '../db/sessions-repo';
import { TranscriptChunksRepo } from '../db/transcript-chunks-repo';

const CONTENT: NoteContent = {
  mode: 'full',
  title: 'Original title',
  summary: 'Original summary.',
  keyPoints: [
    { text: 'Mentions "Laplace".', startMs: 0, endMs: 4000, flags: ['quoted-term-missing'] },
  ],
  tags: ['math'],
  language: 'en',
  uncertainTerms: [],
};

const TRANSCRIPT = [{ startMs: 0, endMs: 4000, text: 'The Fourier transform.' }];

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nova-library-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const setup = (vocabulary: readonly string[] = []) => {
  const db = openDatabase(':memory:');
  const notes = new NotesRepo(db);
  const sessions = new SessionsRepo(db);
  const chunks = new TranscriptChunksRepo(db);

  /** A saved note with its session, transcript chunk and audio file. */
  const addNote = (id: string, sessionId: string, spoolPath: string | null) => {
    sessions.create({ id: sessionId, startedAt: 1, captureSource: null, spoolPath });
    chunks.save(sessionId, 'groq', {
      chunk: { index: 0, startMs: 0, endMs: 30_000 },
      result: { segments: TRANSCRIPT },
    });
    notes.create({
      id,
      sessionId,
      content: CONTENT,
      transcript: TRANSCRIPT,
      aiModel: 'gemini-3.8-flash',
      promptVersion: 'note-v2',
      sttProvider: 'groq',
      now: 5,
    });
  };

  const library = createNoteLibrary({
    db,
    notes,
    sessions,
    chunks,
    now: () => 9,
    getVocabulary: () => vocabulary,
  });
  return { db, notes, chunks, library, addNote };
};

/** A spool file on disk for `name`. */
const spool = (name: string) => {
  const path = join(dir, `${name}.pcm`);
  writeFileSync(path, 'audio');
  return path;
};

describe('reading', () => {
  it('lists, gets and searches saved notes', () => {
    const { library, addNote } = setup();
    addNote('n1', 's1', null);

    const page = library.list({ limit: 50, offset: 0, favoritesOnly: false });
    expect(page.notes.map((n) => n.id)).toEqual(['n1']);
    expect(library.get('n1')?.segments).toEqual(TRANSCRIPT);
    expect(library.search({ query: 'fourier', limit: 50, offset: 0 }).notes[0]?.id).toBe('n1');
  });

  it('returns null for a note that does not exist', () => {
    expect(setup().library.get('nope')).toBeNull();
  });
});

describe('update', () => {
  it('changes only the fields sent', () => {
    const { library, addNote } = setup();
    addNote('n1', 's1', null);
    const note = library.update('n1', { title: 'New title' });
    expect(note).toMatchObject({
      title: 'New title',
      summary: CONTENT.summary,
      keyPoints: CONTENT.keyPoints,
      tags: CONTENT.tags,
      updatedAt: 9,
    });
  });

  it('checks edited key points against the transcript again', () => {
    const { library, addNote } = setup();
    addNote('n1', 's1', null);
    const note = library.update('n1', {
      keyPoints: [
        { text: 'About the "Fourier transform".', startMs: 0, endMs: 4000 },
        { text: 'Mentions "Laplace".', startMs: 0, endMs: 4000 },
        { text: 'Far later.', startMs: 500_000, endMs: 501_000 },
      ],
    });
    expect(note.keyPoints.map((p) => p.flags)).toEqual([
      [],
      ['quoted-term-missing'],
      ['time-range-not-in-transcript'],
    ]);
  });

  it('trusts the vocabulary in the ground check', () => {
    const { library, addNote } = setup(['Laplace']);
    addNote('n1', 's1', null);
    const note = library.update('n1', {
      keyPoints: [{ text: 'Mentions "Laplace".', startMs: 0, endMs: 4000 }],
    });
    expect(note.keyPoints[0]?.flags).toEqual([]);
  });

  it('keeps stored flags when key points are not edited', () => {
    const { library, addNote } = setup(['Laplace']);
    addNote('n1', 's1', null);
    expect(library.update('n1', { summary: 'S' }).keyPoints).toEqual(CONTENT.keyPoints);
  });

  it('normalizes tags, as on save', () => {
    const { library, addNote } = setup();
    addNote('n1', 's1', null);
    expect(library.update('n1', { tags: ['Machine Learning', 'math', 'MATH'] }).tags).toEqual([
      'machine-learning',
      'math',
    ]);
  });

  it('allows removing all key points and tags', () => {
    const { library, addNote } = setup();
    addNote('n1', 's1', null);
    expect(library.update('n1', { keyPoints: [], tags: [] })).toMatchObject({
      keyPoints: [],
      tags: [],
    });
  });

  it('does not count a favorite mark as an edit', () => {
    const { library, addNote } = setup();
    addNote('n1', 's1', null);
    expect(library.update('n1', { favorite: true })).toMatchObject({
      favorite: true,
      updatedAt: 5,
    });
  });

  it('applies a favorite mark and an edit together', () => {
    const { library, addNote } = setup();
    addNote('n1', 's1', null);
    expect(library.update('n1', { favorite: true, title: 'T' })).toMatchObject({
      favorite: true,
      title: 'T',
      updatedAt: 9,
    });
  });

  it('applies nothing when the edit fails', () => {
    const { db, library, notes, addNote } = setup();
    addNote('n1', 's1', null);
    db.exec(
      "CREATE TRIGGER fail_edit BEFORE UPDATE OF title ON notes BEGIN SELECT RAISE(ABORT, 'disk full'); END",
    );
    expect(() => library.update('n1', { favorite: true, title: 'T' })).toThrow(/disk full/);
    expect(notes.get('n1')).toMatchObject({ favorite: false, title: CONTENT.title });
  });

  it('rejects a note that does not exist', () => {
    expect(() => setup().library.update('nope', { title: 'T' })).toThrow(NoteNotFoundError);
  });
});

describe('delete', () => {
  it('removes the note, its transcript chunks and its audio', async () => {
    const { library, chunks, addNote } = setup();
    const path = spool('s1');
    addNote('n1', 's1', path);

    await library.delete('n1');

    expect(library.get('n1')).toBeNull();
    expect(chunks.listBySession('s1')).toEqual([]);
    expect(existsSync(path)).toBe(false);
  });

  it('leaves other notes, their transcripts and their audio alone', async () => {
    const { library, chunks, addNote } = setup();
    const other = spool('s2');
    addNote('n1', 's1', spool('s1'));
    addNote('n2', 's2', other);

    await library.delete('n1');

    expect(library.get('n2')?.segments).toEqual(TRANSCRIPT);
    expect(chunks.listBySession('s2')).toHaveLength(1);
    expect(existsSync(other)).toBe(true);
  });

  it('does nothing for a note that does not exist', async () => {
    await expect(setup().library.delete('nope')).resolves.toBeUndefined();
  });

  it('works when the audio is already gone or was never recorded', async () => {
    const { library, addNote } = setup();
    addNote('n1', 's1', join(dir, 'missing.pcm'));
    addNote('n2', 's2', null);

    await library.delete('n1');
    await library.delete('n2');

    expect(library.get('n1')).toBeNull();
    expect(library.get('n2')).toBeNull();
  });

  it('works for a note with no session', async () => {
    const { db, library } = setup();
    db.prepare(
      `INSERT INTO notes (id, mode, title, summary, key_points, transcript, created_at, updated_at)
       VALUES ('n0', 'full', 'T', 'S', '[]', 't', 1, 1)`,
    ).run();

    await library.delete('n0');

    expect(library.get('n0')).toBeNull();
  });

  it('keeps the note when the audio cannot be removed, so the user can retry', async () => {
    const { library, chunks, addNote } = setup();
    // A folder cannot be removed by a plain file delete, like a file another program has locked.
    const stuck = join(dir, 'stuck.pcm');
    mkdirSync(stuck);
    addNote('n1', 's1', stuck);

    await expect(library.delete('n1')).rejects.toThrow();
    expect(library.get('n1')?.title).toBe(CONTENT.title);
    expect(chunks.listBySession('s1')).toHaveLength(1);

    rmSync(stuck, { recursive: true });
    await library.delete('n1');
    expect(library.get('n1')).toBeNull();
  });

  it('keeps the transcript chunks when the database delete fails', async () => {
    const { db, library, chunks, addNote } = setup();
    addNote('n1', 's1', null);
    db.exec(
      "CREATE TRIGGER fail_chunks BEFORE DELETE ON transcript_chunks BEGIN SELECT RAISE(ABORT, 'disk full'); END",
    );

    await expect(library.delete('n1')).rejects.toThrow(/disk full/);

    expect(library.get('n1')?.title).toBe(CONTENT.title);
    expect(chunks.listBySession('s1')).toHaveLength(1);
  });
});
