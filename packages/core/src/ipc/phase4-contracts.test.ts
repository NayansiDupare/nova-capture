import { describe, expect, it } from 'vitest';

import { IPC_CHANNELS, MAX_NOTES_PAGE_SIZE, MAX_SEARCH_QUERY_LENGTH } from './channels';

const accepts = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

const SUMMARY = {
  id: 'n1',
  mode: 'full',
  title: 'Fourier',
  summary: 'Maps time to frequency.',
  tags: ['math'],
  favorite: false,
  sourceApp: null,
  createdAt: 1,
  updatedAt: 2,
};

const NOTE = {
  ...SUMMARY,
  sessionId: 's1',
  keyPoints: [{ text: 'Sines.', startMs: 0, endMs: 4000, flags: [] }],
  language: 'en',
  uncertainTerms: [],
  segments: [{ startMs: 0, endMs: 4000, text: 'Sines add up.' }],
  aiModel: 'gemini-3.8-flash',
  promptVersion: 'note-v2',
  sttProvider: 'groq',
};

describe('notes:list', () => {
  const { request, response } = IPC_CHANNELS['notes:list'];

  it('defaults to the first page of all notes', () => {
    expect(request.parse({})).toEqual({ limit: 50, offset: 0, favoritesOnly: false });
  });

  it('takes a page and filters', () => {
    const query = { limit: 10, offset: 20, favoritesOnly: true, tag: 'math' };
    expect(request.parse(query)).toEqual(query);
  });

  it.each([
    ['no payload', undefined],
    ['a zero limit', { limit: 0 }],
    ['an oversized page', { limit: MAX_NOTES_PAGE_SIZE + 1 }],
    ['a fractional limit', { limit: 1.5 }],
    ['a negative offset', { offset: -1 }],
    ['an empty tag', { tag: '' }],
    ['an unknown filter', { deleted: true }],
  ])('rejects %s', (_label, payload) => {
    expect(accepts(request, payload)).toBe(false);
  });

  it('returns summaries and whether more follow', () => {
    expect(accepts(response, { notes: [SUMMARY], hasMore: true })).toBe(true);
    expect(accepts(response, { notes: [] })).toBe(false);
  });

  it('keeps the transcript out of a listing', () => {
    expect(accepts(response, { notes: [NOTE], hasMore: false })).toBe(false);
  });
});

describe('notes:get', () => {
  const { request, response } = IPC_CHANNELS['notes:get'];

  it('needs exactly a note id', () => {
    expect(accepts(request, { noteId: 'n1' })).toBe(true);
    expect(accepts(request, {})).toBe(false);
    expect(accepts(request, { noteId: '' })).toBe(false);
    expect(accepts(request, { noteId: 'n1', x: 1 })).toBe(false);
  });

  it('returns the full note or null', () => {
    expect(accepts(response, { note: NOTE })).toBe(true);
    expect(accepts(response, { note: null })).toBe(true);
    expect(accepts(response, { note: SUMMARY })).toBe(false);
  });

  it('rejects unknown fields and grounding flags', () => {
    expect(accepts(response, { note: { ...NOTE, apiKey: 'k' } })).toBe(false);
    const flagged = { ...NOTE, keyPoints: [{ ...NOTE.keyPoints[0], flags: ['looks-fine'] }] };
    expect(accepts(response, { note: flagged })).toBe(false);
  });
});

describe('notes:search', () => {
  const { request, response } = IPC_CHANNELS['notes:search'];

  it('trims the query and defaults to the first page', () => {
    expect(request.parse({ query: '  fourier ' })).toEqual({
      query: 'fourier',
      limit: 50,
      offset: 0,
    });
  });

  it('accepts FTS5 syntax as an ordinary query', () => {
    expect(accepts(request, { query: '"a" AND title:b*' })).toBe(true);
  });

  it.each([
    ['no query', {}],
    ['an empty query', { query: '' }],
    ['a blank query', { query: '   ' }],
    ['an oversized query', { query: 'q'.repeat(MAX_SEARCH_QUERY_LENGTH + 1) }],
    ['an unknown field', { query: 'q', raw: true }],
  ])('rejects %s', (_label, payload) => {
    expect(accepts(request, payload)).toBe(false);
  });

  it('returns summaries with a snippet', () => {
    const hit = { ...SUMMARY, snippet: '…sines add up…' };
    expect(accepts(response, { notes: [hit], hasMore: false })).toBe(true);
    expect(accepts(response, { notes: [SUMMARY], hasMore: false })).toBe(false);
  });
});

describe('notes:update', () => {
  const { request, response } = IPC_CHANNELS['notes:update'];

  it.each([
    [{ title: 'T' }],
    [{ summary: 'S' }],
    [{ keyPoints: [] }],
    [{ tags: [] }],
    [{ favorite: false }],
    [{ title: 'T', favorite: true }],
  ])('accepts the changes %o', (changes) => {
    expect(accepts(request, { noteId: 'n1', changes })).toBe(true);
  });

  it('trims edited text', () => {
    expect(request.parse({ noteId: 'n1', changes: { title: '  T  ' } })).toEqual({
      noteId: 'n1',
      changes: { title: 'T' },
    });
  });

  it.each([
    ['no changes', {}],
    ['only undefined values', { title: undefined }],
    ['an empty title', { title: '  ' }],
    ['a key point with flags', { keyPoints: [{ text: 'P', startMs: 0, endMs: 1, flags: [] }] }],
    ['a model', { aiModel: 'x' }],
    ['a mode', { mode: 'quick' }],
    ['a language', { language: 'en' }],
    ['a transcript', { segments: [] }],
    ['a created time', { createdAt: 1 }],
  ])('rejects %s', (_label, changes) => {
    expect(accepts(request, { noteId: 'n1', changes })).toBe(false);
  });

  it('needs a note id', () => {
    expect(accepts(request, { changes: { title: 'T' } })).toBe(false);
  });

  it('returns the updated note', () => {
    expect(accepts(response, { note: NOTE })).toBe(true);
    expect(accepts(response, { note: null })).toBe(false);
  });
});

describe('notes:delete', () => {
  const { request, response } = IPC_CHANNELS['notes:delete'];

  it('needs exactly a note id', () => {
    expect(accepts(request, { noteId: 'n1' })).toBe(true);
    expect(accepts(request, { noteId: '' })).toBe(false);
    expect(accepts(request, { noteId: 'n1', keepAudio: true })).toBe(false);
    expect(accepts(request, undefined)).toBe(false);
  });

  it('returns nothing', () => {
    expect(accepts(response, {})).toBe(true);
    expect(accepts(response, { noteId: 'n1' })).toBe(false);
  });
});
