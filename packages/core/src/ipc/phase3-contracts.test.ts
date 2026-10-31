import { describe, expect, it } from 'vitest';

import { IPC_CHANNELS } from './channels';

const accepts = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

const DRAFT = {
  sessionId: 's1',
  content: {
    mode: 'full',
    title: 'Fourier',
    summary: 'Maps time to frequency.',
    keyPoints: [{ text: 'Sines.', startMs: 0, endMs: 4000, flags: ['quoted-term-missing'] }],
    tags: ['math'],
    language: 'en',
    uncertainTerms: [],
  },
  aiModel: 'gemini-3.8-flash',
  promptVersion: 'note-v1',
  createdAt: 1,
};

const EDITS = {
  title: 'Fourier',
  summary: 'Edited.',
  keyPoints: [{ text: 'Sines.', startMs: 0, endMs: 4000 }],
  tags: ['math'],
};

describe('notes:draft', () => {
  const { request, response } = IPC_CHANNELS['notes:draft'];

  it('needs exactly a session id', () => {
    expect(accepts(request, { sessionId: 's1' })).toBe(true);
    expect(accepts(request, {})).toBe(false);
    expect(accepts(request, { sessionId: 's1', x: 1 })).toBe(false);
  });

  it('returns a draft or null', () => {
    expect(accepts(response, { draft: DRAFT })).toBe(true);
    expect(accepts(response, { draft: null })).toBe(true);
    expect(accepts(response, {})).toBe(false);
  });

  it('rejects unknown grounding flags and modes', () => {
    const keyPoints = [{ ...DRAFT.content.keyPoints[0], flags: ['looks-fine'] }];
    const badFlag = { ...DRAFT, content: { ...DRAFT.content, keyPoints } };
    expect(accepts(response, { draft: badFlag })).toBe(false);
    expect(
      accepts(response, { draft: { ...DRAFT, content: { ...DRAFT.content, mode: 'long' } } }),
    ).toBe(false);
  });
});

describe('notes:save', () => {
  const { request, response } = IPC_CHANNELS['notes:save'];

  it('takes a session id and the edited fields', () => {
    expect(accepts(request, { sessionId: 's1', note: EDITS })).toBe(true);
    expect(accepts(request, { sessionId: 's1', note: { ...EDITS, keyPoints: [] } })).toBe(true);
  });

  it('rejects fields the renderer may not set', () => {
    expect(accepts(request, { sessionId: 's1', note: { ...EDITS, aiModel: 'x' } })).toBe(false);
    expect(accepts(request, { sessionId: 's1', note: { ...EDITS, language: 'en' } })).toBe(false);
    const flagged = { ...EDITS, keyPoints: [{ ...EDITS.keyPoints[0], flags: [] }] };
    expect(accepts(request, { sessionId: 's1', note: flagged })).toBe(false);
  });

  it('rejects empty titles and oversized notes', () => {
    expect(accepts(request, { sessionId: 's1', note: { ...EDITS, title: '' } })).toBe(false);
    const tooMany = { ...EDITS, tags: Array.from({ length: 13 }, () => 't') };
    expect(accepts(request, { sessionId: 's1', note: tooMany })).toBe(false);
  });

  it('returns the new note id', () => {
    expect(accepts(response, { noteId: 'n1' })).toBe(true);
    expect(accepts(response, { noteId: '' })).toBe(false);
  });
});
