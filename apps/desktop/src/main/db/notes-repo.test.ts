import { describe, expect, it } from 'vitest';

import type { NoteContent, NoteDraft } from '@nova/core';

import { NoteDraftsRepo } from './note-drafts-repo';
import { NotesRepo } from './notes-repo';
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
      segments: TRANSCRIPT,
      favorite: false,
      sourceApp: null,
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

const PAGE = { limit: 50, offset: 0 };
const ALL = { ...PAGE, favoritesOnly: false };

/** Three notes, oldest first: `old` (math), `mid` (physics), `new` (math, physics, from Chrome). */
const library = () => {
  const context = setup();
  context.db
    .prepare(
      "INSERT INTO sessions (id, state, started_at, source_app) VALUES ('s3', 'SAVED', 1, 'Chrome')",
    )
    .run();
  const add = (id: string, sessionId: string, now: number, tags: string[]) => {
    context.notes.create(
      note({ id, sessionId, now, content: { ...CONTENT, title: id, tags, keyPoints: [] } }),
    );
  };
  add('old', 's1', 1, ['math']);
  add('mid', 's2', 2, ['physics']);
  add('new', 's3', 3, ['math', 'physics']);
  return context;
};

const ids = (page: { notes: readonly { id: string }[] }) => page.notes.map((n) => n.id);

describe('NotesRepo.list', () => {
  it('lists notes newest first, with what a card shows', () => {
    const { notes } = library();
    const page = notes.list(ALL);
    expect(ids(page)).toEqual(['new', 'mid', 'old']);
    expect(page.hasMore).toBe(false);
    expect(page.notes[0]).toEqual({
      id: 'new',
      mode: 'full',
      title: 'new',
      summary: CONTENT.summary,
      tags: ['math', 'physics'],
      favorite: false,
      sourceApp: 'Chrome',
      createdAt: 3,
      updatedAt: 3,
    });
  });

  it('returns nothing from an empty library', () => {
    expect(setup().notes.list(ALL)).toEqual({ notes: [], hasMore: false });
  });

  it('pages through notes and says when more follow', () => {
    const { notes } = library();
    const first = notes.list({ ...ALL, limit: 2 });
    expect(ids(first)).toEqual(['new', 'mid']);
    expect(first.hasMore).toBe(true);

    const second = notes.list({ ...ALL, limit: 2, offset: 2 });
    expect(ids(second)).toEqual(['old']);
    expect(second.hasMore).toBe(false);

    expect(notes.list({ ...ALL, limit: 3 }).hasMore).toBe(false);
  });

  it('breaks ties between notes saved at the same moment', () => {
    const { notes } = setup();
    notes.create(note({ id: 'a', sessionId: 's1', now: 1 }));
    notes.create(note({ id: 'b', sessionId: 's2', now: 1 }));
    expect(ids(notes.list(ALL))).toEqual(['b', 'a']);
  });

  it('filters by favorite and by tag, and combines the two', () => {
    const { notes } = library();
    notes.setFavorite('old', true);
    notes.setFavorite('mid', true);

    expect(ids(notes.list({ ...ALL, favoritesOnly: true }))).toEqual(['mid', 'old']);
    expect(ids(notes.list({ ...ALL, tag: 'math' }))).toEqual(['new', 'old']);
    expect(ids(notes.list({ ...ALL, favoritesOnly: true, tag: 'math' }))).toEqual(['old']);
    expect(ids(notes.list({ ...ALL, tag: 'chemistry' }))).toEqual([]);
  });

  it('treats a tag as a value, not as SQL', () => {
    const { notes } = library();
    expect(ids(notes.list({ ...ALL, tag: "x' OR '1'='1" }))).toEqual([]);
  });

  it('uses the indexes, so a listing never reads every transcript', () => {
    const { db } = library();
    const plan = (where: string) =>
      JSON.stringify(
        db
          .prepare(
            `EXPLAIN QUERY PLAN SELECT n.id FROM notes n LEFT JOIN sessions s ON s.id = n.session_id
             WHERE n.deleted_at IS NULL ${where}
             ORDER BY n.created_at DESC, n.id DESC LIMIT 51 OFFSET 0`,
          )
          .all(),
      );
    expect(plan('')).toContain('notes_newest');
    expect(plan('AND n.favorite = 1')).toContain('notes_favorites');
  });
});

describe('NotesRepo.search', () => {
  const searchable = () => {
    const { notes, db } = setup();
    notes.create(
      note({
        id: 'in-title',
        content: { ...CONTENT, title: 'Laplace basics', summary: 'S', keyPoints: [], tags: [] },
        transcript: [{ startMs: 0, endMs: 1000, text: 'Something else entirely.' }],
      }),
    );
    notes.create(
      note({
        id: 'in-transcript',
        sessionId: 's2',
        content: { ...CONTENT, title: 'Other', summary: 'S', keyPoints: [], tags: [] },
        transcript: [{ startMs: 0, endMs: 1000, text: 'Later we also mention laplace once.' }],
      }),
    );
    return { notes, db };
  };

  it('finds notes by title, summary, key points, tags and transcript', () => {
    const { notes } = setup();
    notes.create(
      note({
        content: {
          ...CONTENT,
          title: 'Alpha',
          summary: 'Bravo',
          keyPoints: [{ text: 'Charlie', startMs: 0, endMs: 1000, flags: [] }],
          tags: ['delta'],
        },
        transcript: [{ startMs: 0, endMs: 1000, text: 'Echo' }],
      }),
    );
    for (const query of ['alpha', 'bravo', 'charlie', 'delta', 'echo']) {
      expect(ids(notes.search({ ...PAGE, query }))).toEqual(['n1']);
    }
    expect(ids(notes.search({ ...PAGE, query: 'foxtrot' }))).toEqual([]);
  });

  it('matches word forms, partly typed last words and accented text', () => {
    const { notes } = setup();
    notes.create(note());
    expect(ids(notes.search({ ...PAGE, query: 'run' }))).toEqual(['n1']);
    expect(ids(notes.search({ ...PAGE, query: 'four' }))).toEqual(['n1']);
    expect(ids(notes.search({ ...PAGE, query: 'français' }))).toEqual(['n1']);
  });

  it('does not match a last word of under four letters as a prefix', () => {
    const { notes } = setup();
    notes.create(note());
    expect(ids(notes.search({ ...PAGE, query: 'fou' }))).toEqual([]);
  });

  it('finds words in other scripts', () => {
    const { notes } = setup();
    notes.create(
      note({ transcript: [{ startMs: 0, endMs: 1000, text: 'आज हम हिन्दी में पढ़ेंगे।' }] }),
    );
    expect(ids(notes.search({ ...PAGE, query: 'हिन्दी' }))).toEqual(['n1']);
    expect(ids(notes.search({ ...PAGE, query: 'गणित' }))).toEqual([]);
  });

  it('needs every word to match', () => {
    const { notes } = setup();
    notes.create(note());
    expect(ids(notes.search({ ...PAGE, query: 'fourier signals' }))).toEqual(['n1']);
    expect(ids(notes.search({ ...PAGE, query: 'fourier laplace' }))).toEqual([]);
  });

  it('ranks a match in the title above one in the transcript', () => {
    const { notes } = searchable();
    expect(ids(notes.search({ ...PAGE, query: 'laplace' }))).toEqual(['in-title', 'in-transcript']);
  });

  it('returns a plain-text snippet around the match', () => {
    const { notes } = searchable();
    const hit = notes
      .search({ ...PAGE, query: 'mention' })
      .notes.find((n) => n.id === 'in-transcript');
    expect(hit?.snippet).toContain('mention');
    expect(hit?.snippet).not.toMatch(/[<>]/);
    expect(hit?.title).toBe('Other');
  });

  it('pages through results', () => {
    const { notes } = searchable();
    const first = notes.search({ query: 'laplace', limit: 1, offset: 0 });
    expect(ids(first)).toEqual(['in-title']);
    expect(first.hasMore).toBe(true);

    const second = notes.search({ query: 'laplace', limit: 1, offset: 1 });
    expect(ids(second)).toEqual(['in-transcript']);
    expect(second.hasMore).toBe(false);
  });

  it.each([
    '"',
    '""',
    'fourier"',
    '"fourier',
    'AND',
    'fourier AND',
    'OR NOT',
    'NEAR(fourier',
    'title:fourier',
    'nosuchcolumn:fourier',
    '-fourier',
    'fourier*',
    '*',
    '(',
    ')',
    '^fourier',
    '{title}',
    '!!!',
    "'; DROP TABLE notes; --",
    '́',
  ])('never raises a syntax error for %j', (query) => {
    const { notes, db } = searchable();
    expect(() => notes.search({ ...PAGE, query })).not.toThrow();
    expect(db.prepare('SELECT count(*) AS n FROM notes').get()).toEqual({ n: 2 });
  });

  it('finds words next to punctuation, and ignores words with no letters', () => {
    const { notes } = searchable();
    expect(ids(notes.search({ ...PAGE, query: '"laplace" basics' }))).toEqual(['in-title']);
    expect(ids(notes.search({ ...PAGE, query: 'laplace !!!' }))).toHaveLength(2);
  });

  it('returns nothing when the query has no words', () => {
    const { notes } = searchable();
    expect(notes.search({ ...PAGE, query: '\0' })).toEqual({ notes: [], hasMore: false });
    expect(notes.search({ ...PAGE, query: '!!!' }).notes).toEqual([]);
  });
});

describe('NotesRepo.update', () => {
  const EDIT = {
    title: 'Laplace transforms',
    summary: 'Edited summary.',
    keyPoints: [{ text: 'Poles matter.', startMs: 0, endMs: 4000, flags: [] }],
    tags: ['math', 'engineering'],
  };
  const hits = (notes: NotesRepo, query: string) => ids(notes.search({ ...PAGE, query }));

  it('replaces the content and the updated time, and keeps everything else', () => {
    const { notes } = setup();
    notes.create(note());
    notes.update('n1', EDIT, 9);
    expect(notes.get('n1')).toMatchObject({
      ...EDIT,
      tags: ['engineering', 'math'],
      mode: 'full',
      language: 'en',
      uncertainTerms: ['Nyquist'],
      segments: TRANSCRIPT,
      createdAt: 5,
      updatedAt: 9,
    });
  });

  it('keeps search in step with the edit, and the transcript searchable', () => {
    const { notes } = setup();
    notes.create(note());
    notes.update('n1', EDIT, 9);
    expect(hits(notes, 'laplace')).toEqual(['n1']);
    expect(hits(notes, 'poles')).toEqual(['n1']);
    expect(hits(notes, 'engineering')).toEqual(['n1']);
    expect(hits(notes, 'sines')).toEqual([]);
    expect(hits(notes, 'signal')).toEqual([]);
    // "Fourier" is only in the transcript now.
    expect(hits(notes, 'fourier')).toEqual(['n1']);
  });

  it('leaves the search entries of other notes alone', () => {
    const { notes } = setup();
    notes.create(note());
    notes.create(note({ id: 'n2', sessionId: 's2' }));
    notes.update('n1', EDIT, 9);
    expect(hits(notes, 'sines')).toEqual(['n2']);
    expect(hits(notes, 'laplace')).toEqual(['n1']);
  });

  it('drops a tag no note uses any more, and keeps a shared one', () => {
    const { db, notes } = setup();
    notes.create(note());
    notes.create(note({ id: 'n2', sessionId: 's2', content: { ...CONTENT, tags: ['math'] } }));
    notes.update('n1', { ...EDIT, tags: ['engineering'] }, 9);
    const tags = db.prepare('SELECT name FROM tags ORDER BY name').all();
    expect(tags.map((t) => t['name'])).toEqual(['engineering', 'math']);
    expect(notes.get('n2')?.tags).toEqual(['math']);
  });

  it('writes nothing when any part of the update fails', () => {
    const { db, notes } = setup();
    notes.create(note());
    db.exec(
      "CREATE TRIGGER fail_tags BEFORE INSERT ON note_tags BEGIN SELECT RAISE(ABORT, 'disk full'); END",
    );
    expect(() => {
      notes.update('n1', EDIT, 9);
    }).toThrow(/disk full/);
    expect(notes.get('n1')).toMatchObject({ title: CONTENT.title, updatedAt: 5 });
    expect(notes.get('n1')?.tags).toEqual(['math', 'signal-processing']);
    expect(hits(notes, 'sines')).toEqual(['n1']);
  });
});

describe('NotesRepo.setFavorite', () => {
  it('marks and unmarks a favorite without counting as an edit', () => {
    const { notes } = setup();
    notes.create(note());
    notes.setFavorite('n1', true);
    expect(notes.get('n1')).toMatchObject({ favorite: true, updatedAt: 5 });
    notes.setFavorite('n1', false);
    expect(notes.get('n1')).toMatchObject({ favorite: false, updatedAt: 5 });
  });
});

describe('NotesRepo.delete', () => {
  const countOf = (db: ReturnType<typeof openDatabase>, table: string) =>
    db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.['n'];

  it('removes the note, its segments, tags and search entry, and nothing of other notes', () => {
    const { db, notes, search } = setup();
    notes.create(note());
    notes.create(note({ id: 'n2', sessionId: 's2', content: { ...CONTENT, tags: ['math'] } }));

    notes.delete('n1');

    expect(notes.get('n1')).toBeUndefined();
    expect(search('fourier')).toEqual(['n2']);
    expect(db.prepare("SELECT count(*) AS n FROM segments WHERE note_id = 'n1'").get()).toEqual({
      n: 0,
    });
    expect(db.prepare("SELECT count(*) AS n FROM note_tags WHERE note_id = 'n1'").get()).toEqual({
      n: 0,
    });
    expect(notes.get('n2')?.segments).toEqual(TRANSCRIPT);
    expect(db.prepare('SELECT name FROM tags').all()).toEqual([{ name: 'math' }]);
  });

  it('leaves nothing behind when the last note goes', () => {
    const { db, notes } = setup();
    notes.create(note());
    notes.delete('n1');
    for (const table of ['notes', 'segments', 'note_tags', 'tags', 'notes_fts']) {
      expect(countOf(db, table)).toBe(0);
    }
  });

  it('keeps everything when any part of the delete fails', () => {
    const { db, notes, search } = setup();
    notes.create(note());
    db.exec(
      "CREATE TRIGGER fail_delete BEFORE DELETE ON notes BEGIN SELECT RAISE(ABORT, 'disk full'); END",
    );
    expect(() => {
      notes.delete('n1');
    }).toThrow(/disk full/);
    expect(notes.get('n1')?.tags).toEqual(['math', 'signal-processing']);
    expect(search('fourier')).toEqual(['n1']);
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
