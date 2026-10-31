import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';

import { DEFAULT_SETTINGS, IPC_CHANNELS } from '@nova/core';
import type { NoteDraft } from '@nova/core';

import { createIpcHandlers } from './handlers';
import type { CaptureControl } from './handlers';
import { IpcRequestError, registerIpcHandlers } from './ipc-router';
import type { InvokeEvent } from './ipc-router';
import { isTrustedSender } from './trusted-sender';
import { NotesRepo } from '../db/notes-repo';
import { openDatabase } from '../db/open-database';
import { SessionsRepo } from '../db/sessions-repo';
import { SettingsRepo } from '../db/settings-repo';
import { TranscriptChunksRepo } from '../db/transcript-chunks-repo';
import { log } from '../log';
import { createNoteLibrary } from '../notes/note-library';
import type { Encryptor } from '../secrets/secret-store';
import { SecretStore } from '../secrets/secret-store';

type Listener = (event: InvokeEvent, ...args: unknown[]) => unknown;

const TRUSTED_ID = 1;
const fromMainWindow: InvokeEvent = { sender: { id: TRUSTED_ID }, senderFrame: { parent: null } };

const encryptor: Encryptor = {
  isEncryptionAvailable: () => true,
  encryptString: (plainText) => Buffer.from(plainText, 'utf8').reverse(),
  decryptString: (encrypted) => Buffer.from(encrypted).reverse().toString('utf8'),
};

const DRAFT: NoteDraft = {
  sessionId: 's1',
  content: {
    mode: 'quick',
    title: 'Fourier',
    summary: 'Time to frequency.',
    keyPoints: [],
    tags: ['math'],
    language: 'en',
    uncertainTerms: [],
  },
  aiModel: 'fake-llm-1',
  promptVersion: 'note-v1',
  createdAt: 1,
};

/** Records the intents the UI sends; the real orchestrator has its own tests. */
const fakeCapture = () => {
  const calls: string[] = [];
  const capture: CaptureControl = {
    start: () => {
      calls.push('start');
      return Promise.resolve('s1');
    },
    stop: () => {
      calls.push('stop');
      return Promise.resolve();
    },
    pause: () => calls.push('pause'),
    resume: () => calls.push('resume'),
    retry: (id) => {
      calls.push(`retry ${id}`);
      return Promise.resolve();
    },
    discard: (id) => {
      calls.push(`discard ${id}`);
      return Promise.resolve();
    },
    transcript: () => [{ startMs: 0, endMs: 1000, text: 'Hello class.' }],
    draft: (id) => (id === 's1' ? DRAFT : null),
    save: (id, edits) => {
      calls.push(`save ${id} ${edits.title}`);
      return 'n1';
    },
  };
  return { capture, calls };
};

const libraryFor = (db: ReturnType<typeof openDatabase>) =>
  createNoteLibrary({
    db,
    notes: new NotesRepo(db),
    sessions: new SessionsRepo(db),
    chunks: new TranscriptChunksRepo(db),
    now: () => 9,
    getVocabulary: () => [],
  });

const setup = () => {
  const db = openDatabase(':memory:');
  const secrets = new SecretStore(db, encryptor);
  const { capture, calls } = fakeCapture();
  const listeners = new Map<string, Listener>();
  registerIpcHandlers(
    { handle: (channel, listener) => listeners.set(channel, listener) },
    createIpcHandlers({
      settings: new SettingsRepo(db),
      secrets,
      capture,
      library: libraryFor(db),
    }),
    (event) => isTrustedSender(event, new Set([TRUSTED_ID])),
  );
  const invoke = (channel: string, event: InvokeEvent, ...args: unknown[]) => {
    const listener = listeners.get(channel);
    if (!listener) throw new Error(`No handler for ${channel}`);
    return Promise.resolve(listener(event, ...args));
  };
  return { db, listeners, secrets, invoke, calls };
};

describe('IPC router', () => {
  let warn: MockInstance<typeof log.warn>;

  beforeEach(() => {
    warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warn.mockRestore();
  });

  it('registers exactly the channels defined in core', () => {
    expect([...setup().listeners.keys()].sort()).toEqual(Object.keys(IPC_CHANNELS).sort());
  });

  it('serves settings:get and settings:set', async () => {
    const { invoke } = setup();
    await expect(invoke('settings:get', fromMainWindow)).resolves.toEqual(DEFAULT_SETTINGS);
    await expect(
      invoke('settings:set', fromMainWindow, { sttProvider: 'deepgram' }),
    ).resolves.toEqual({ ...DEFAULT_SETTINGS, sttProvider: 'deepgram' });
  });

  it('stores a secret without returning it', async () => {
    const { invoke, secrets } = setup();
    const reply = await invoke('secrets:set', fromMainWindow, { id: 'groq', apiKey: ' gsk_abc ' });
    expect(reply).toEqual({ ok: true });
    expect(secrets.reveal('groq')).toBe('gsk_abc');
  });

  it('rejects an invalid payload without logging its contents', async () => {
    const { invoke, secrets } = setup();
    const payload = { id: 'openai', apiKey: 'sk_leak_me' };

    await expect(invoke('secrets:set', fromMainWindow, payload)).rejects.toThrow(IpcRequestError);

    expect(secrets.has('groq')).toBe(false);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('sk_leak_me');
    expect(warn).toHaveBeenCalledWith('rejected invalid IPC payload', {
      channel: 'secrets:set',
      issues: [{ path: 'id', code: 'invalid_value' }],
    });
  });

  it('rejects extra arguments', async () => {
    const { invoke } = setup();
    await expect(invoke('settings:set', fromMainWindow, {}, 'extra')).rejects.toThrow(
      /unexpected arguments/,
    );
  });

  it.each([
    ['an unknown window', { sender: { id: 99 }, senderFrame: { parent: null } }],
    ['a subframe', { sender: { id: TRUSTED_ID }, senderFrame: { parent: {} } }],
    ['a destroyed frame', { sender: { id: TRUSTED_ID }, senderFrame: null }],
  ])('rejects calls from %s', async (_label, event: InvokeEvent) => {
    const { invoke } = setup();
    await expect(invoke('settings:get', event)).rejects.toThrow(/untrusted sender/);
  });

  it('routes capture and session intents to the orchestrator', async () => {
    const { invoke, calls } = setup();
    await expect(invoke('capture:start', fromMainWindow)).resolves.toEqual({ sessionId: 's1' });
    await expect(invoke('capture:pause', fromMainWindow)).resolves.toEqual({});
    await expect(invoke('capture:resume', fromMainWindow)).resolves.toEqual({});
    await expect(invoke('capture:stop', fromMainWindow)).resolves.toEqual({});
    await invoke('sessions:retry', fromMainWindow, { sessionId: 's1' });
    await invoke('sessions:discard', fromMainWindow, { sessionId: 's1' });
    expect(calls).toEqual(['start', 'pause', 'resume', 'stop', 'retry s1', 'discard s1']);
  });

  it('returns the transcript for a session', async () => {
    const { invoke } = setup();
    await expect(
      invoke('sessions:transcript', fromMainWindow, { sessionId: 's1' }),
    ).resolves.toEqual({
      segments: [{ startMs: 0, endMs: 1000, text: 'Hello class.' }],
    });
  });

  it('returns the note draft, or null when there is none', async () => {
    const { invoke } = setup();
    await expect(invoke('notes:draft', fromMainWindow, { sessionId: 's1' })).resolves.toEqual({
      draft: DRAFT,
    });
    await expect(invoke('notes:draft', fromMainWindow, { sessionId: 's2' })).resolves.toEqual({
      draft: null,
    });
  });

  it('saves the edited note with trimmed text and returns its id', async () => {
    const { invoke, calls } = setup();
    const note = { title: '  Fourier  ', summary: 'S', keyPoints: [], tags: ['math'] };
    await expect(invoke('notes:save', fromMainWindow, { sessionId: 's1', note })).resolves.toEqual({
      noteId: 'n1',
    });
    expect(calls).toEqual(['save s1 Fourier']);
  });

  it('serves a saved note through list, search, get, update and delete', async () => {
    const { db, invoke } = setup();
    db.prepare("INSERT INTO sessions (id, state, started_at) VALUES ('s1', 'SAVED', 1)").run();
    new NotesRepo(db).create({
      id: 'n1',
      sessionId: 's1',
      content: DRAFT.content,
      transcript: [{ startMs: 0, endMs: 1000, text: 'Hello class.', confidence: 0.9 }],
      aiModel: 'fake-llm-1',
      promptVersion: 'note-v1',
      sttProvider: 'fake-stt',
      now: 5,
    });

    await expect(invoke('notes:list', fromMainWindow, {})).resolves.toMatchObject({
      notes: [{ id: 'n1', title: 'Fourier', tags: ['math'] }],
      hasMore: false,
    });
    await expect(
      invoke('notes:search', fromMainWindow, { query: ' hello ' }),
    ).resolves.toMatchObject({ notes: [{ id: 'n1', snippet: 'Hello class.' }], hasMore: false });
    await expect(invoke('notes:get', fromMainWindow, { noteId: 'n1' })).resolves.toMatchObject({
      note: { segments: [{ text: 'Hello class.', confidence: 0.9 }] },
    });
    await expect(
      invoke('notes:update', fromMainWindow, {
        noteId: 'n1',
        changes: { title: '  Laplace ', favorite: true },
      }),
    ).resolves.toMatchObject({ note: { title: 'Laplace', favorite: true, updatedAt: 9 } });
    await expect(invoke('notes:delete', fromMainWindow, { noteId: 'n1' })).resolves.toEqual({});
    await expect(invoke('notes:get', fromMainWindow, { noteId: 'n1' })).resolves.toEqual({
      note: null,
    });
  });

  it('tells the renderer when the note to update is gone', async () => {
    const { invoke } = setup();
    await expect(
      invoke('notes:update', fromMainWindow, { noteId: 'gone', changes: { title: 'T' } }),
    ).rejects.toThrow('This note no longer exists.');
  });

  it.each([
    ['a note with a model field', 'notes:save', { sessionId: 's1', note: { aiModel: 'x' } }],
    ['a missing session id', 'sessions:retry', {}],
    ['an empty session id', 'sessions:discard', { sessionId: '' }],
    ['a payload on capture:start', 'capture:start', { force: true }],
    ['an oversized page', 'notes:list', { limit: 1000 }],
    ['a missing note id', 'notes:get', {}],
    ['a blank search', 'notes:search', { query: '   ' }],
    ['an update with a model field', 'notes:update', { noteId: 'n1', changes: { aiModel: 'x' } }],
    ['an update with no changes', 'notes:update', { noteId: 'n1', changes: {} }],
    ['an empty note id on delete', 'notes:delete', { noteId: '' }],
  ])('rejects %s', async (_label, channel, payload) => {
    const { invoke, calls } = setup();
    await expect(invoke(channel, fromMainWindow, payload)).rejects.toThrow(/invalid payload/);
    expect(calls).toEqual([]);
  });

  it('refuses to send a reply that breaks the response schema', async () => {
    const db = openDatabase(':memory:');
    const listeners = new Map<string, Listener>();
    registerIpcHandlers(
      { handle: (channel, listener) => listeners.set(channel, listener) },
      {
        ...createIpcHandlers({
          settings: new SettingsRepo(db),
          secrets: new SecretStore(db, encryptor),
          capture: fakeCapture().capture,
          library: libraryFor(db),
        }),
        'settings:get': () => ({ ...DEFAULT_SETTINGS, apiKey: 'oops' }),
      },
      () => true,
    );
    await expect(listeners.get('settings:get')?.(fromMainWindow)).rejects.toThrow();
  });
});
