import { describe, expect, it } from 'vitest';

import type { NoteContent, NoteDraft } from '@nova/core';

import { NoteDraftsRepo } from './note-drafts-repo';
import { NotesRepo, transcriptText } from './notes-repo';
import type { NewNote } from './notes-repo';
import { openDatabase } from './open-database';

const CONTENT: NoteContent = {
  mode: 'full',
  title: 'Running Fourier transforms',
  summary: 'How signals map to frequencies.',
  keyPoints: [{ text: 'Sines add up.', startMs: 0, endMs: 4000, flags: [] }],
  tags: ['signal-processing', 'math'],
  language: 'en',
  uncertainTerms: ['Nyquist'],
};

const TRANSCRIPT = [
  { startMs: 0, endMs: 4000, text: 'Today we look at the Fourier transform.', confidence: 0.9 },
  { startMs: 4000, endMs: 9000, text: 'Ça marche aussi en français.' },
];

const note = (overrides: Partial<NewNote> = {}): NewNote => ({
  id: 'n1',
  sessionId: 's1',
  content: CONTENT,
  transcript: TRANSCRIPT,
  aiModel: 'gemini-3.8-flash',
  promptVersion: 'note-v1',
  sttProvider: 'groq',
  now: 5,
  ...overrides,
});

const setup = () => {
  const db = openDatabase(':memory:');
  db.prepare("INSERT INTO sessions (id, state, started_at) VALUES ('s1', 'REVIEW', 1)").run();
  db.prepare("INSERT INTO sessions (id, state, started_at) VALUES ('s2', 'REVIEW', 1)").run();
  const search = (query: string) =>
    db
      .prepare('SELECT note_id FROM notes_fts WHERE notes_fts MATCH ? ORDER BY note_id')
      .all(query)
      .map((r) => r['note_id']);
  return { db, notes: new NotesRepo(db), drafts: new NoteDraftsRepo(db), search };
};

describe('NotesRepo', () => {
  it('saves a note with its segments and tags, and reads it back', () => {
    const { db, notes } = setup();
    notes.create(note());

    expect(notes.get('n1')).toEqual({
      id: 'n1',
      sessionId: 's1',
      mode: 'full',
      title: CONTENT.title,
      summary: CONTENT.summary,
      keyPoints: CONTENT.keyPoints,
      tags: ['math', 'signal-processing'],
      language: 'en',
      uncertainTerms: ['Nyquist'],
      transcript: transcriptText(TRANSCRIPT),
      aiModel: 'gemini-3.8-flash',
      promptVersion: 'note-v1',
      sttProvider: 'groq',
      createdAt: 5,
      updatedAt: 5,
    });
    expect(db.prepare('SELECT start_ms, text, confidence FROM segments ORDER BY id').all()).toEqual(
      [
        { start_ms: 0, text: TRANSCRIPT[0]?.text, confidence: 0.9 },
        { start_ms: 4000, text: TRANSCRIPT[1]?.text, confidence: null },
      ],
    );
    expect(notes.idForSession('s1')).toBe('n1');
    expect(notes.idForSession('s2')).toBeUndefined();
  });

  it('shares tags between notes', () => {
    const { db, notes } = setup();
    notes.create(note());
    notes.create(note({ id: 'n2', sessionId: 's2', content: { ...CONTENT, tags: ['math'] } }));
    expect(db.prepare('SELECT count(*) AS n FROM tags').get()).toEqual({ n: 2 });
    expect(notes.get('n2')?.tags).toEqual(['math']);
  });

  it('indexes title, key points, tags and transcript for search, with stemming and Unicode', () => {
    const { notes, search } = setup();
    notes.create(note());
    expect(search('run')).toEqual(['n1']);
    expect(search('sines')).toEqual(['n1']);
    expect(search('tags:math')).toEqual(['n1']);
    expect(search('français')).toEqual(['n1']);
    expect(search('laplace')).toEqual([]);
  });

  it('writes nothing when any part of the save fails', () => {
    const { db, notes, search } = setup();
    notes.create(note());

    // Fail after the notes row is written but before segments, tags and FTS.
    db.exec(
      "CREATE TRIGGER fail_segments BEFORE INSERT ON segments BEGIN SELECT RAISE(ABORT, 'disk full'); END",
    );
    expect(() => {
      notes.create(note({ id: 'n2', sessionId: 's2' }));
    }).toThrow(/disk full/);

    expect(notes.get('n2')).toBeUndefined();
    expect(db.prepare("SELECT count(*) AS n FROM note_tags WHERE note_id = 'n2'").get()).toEqual({
      n: 0,
    });
    expect(search('fourier')).toEqual(['n1']);
  });

  it('rejects a second note for the same session', () => {
    const { notes } = setup();
    notes.create(note());
    expect(() => {
      notes.create(note({ id: 'n2' }));
    }).toThrow(/UNIQUE/);
  });
});

describe('NoteDraftsRepo', () => {
  const draft: NoteDraft = {
    sessionId: 's1',
    content: CONTENT,
    aiModel: 'gemini-3.8-flash',
    promptVersion: 'note-v1',
    createdAt: 3,
  };

  it('saves and reads a draft', () => {
    const { drafts } = setup();
    drafts.save(draft);
    expect(drafts.get('s1')).toEqual(draft);
    expect(drafts.get('s2')).toBeUndefined();
  });

  it('keeps the first draft when saved twice', () => {
    const { drafts } = setup();
    drafts.save(draft);
    drafts.save({ ...draft, content: { ...CONTENT, title: 'Second' } });
    expect(drafts.get('s1')?.content.title).toBe(CONTENT.title);
  });

  it('deletes a draft', () => {
    const { drafts } = setup();
    drafts.save(draft);
    drafts.delete('s1');
    expect(drafts.get('s1')).toBeUndefined();
  });

  it('rejects a stored draft that no longer matches the schema', () => {
    const { db, drafts } = setup();
    db.prepare(
      "INSERT INTO note_drafts (session_id, content, ai_model, prompt_version, created_at) VALUES ('s1', '{}', 'm', 'v', 1)",
    ).run();
    expect(() => drafts.get('s1')).toThrow();
  });
});
