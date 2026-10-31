import { describe, expect, it } from 'vitest';

import type { IpcEvent, IpcEventPayload, NoteDraft } from '@nova/core';

import { createSessionStore, errorMessage } from './session-store';
import type { SessionApi } from './session-store';

const DRAFT: NoteDraft = {
  sessionId: 's1',
  content: {
    mode: 'quick',
    title: 'Fourier',
    summary: 'Time to frequency.',
    keyPoints: [],
    tags: [],
    language: 'en',
    uncertainTerms: [],
  },
  aiModel: 'fake-llm-1',
  promptVersion: 'note-v1',
  createdAt: 1,
};

/** A fake preload API that records calls and lets the test emit main → UI events. */
const fakeApi = () => {
  const calls: string[] = [];
  const listeners = new Map<IpcEvent, (payload: never) => void>();
  let failSave: Error | undefined;
  const ok = (name: string) => () => {
    calls.push(name);
    return Promise.resolve({});
  };
  const api: SessionApi = {
    capture: {
      start: () => (calls.push('start'), Promise.resolve({ sessionId: 's1' })),
      stop: ok('stop'),
      pause: ok('pause'),
      resume: ok('resume'),
    },
    sessions: {
      retry: ({ sessionId }) => ok(`retry ${sessionId}`)(),
      discard: ({ sessionId }) => ok(`discard ${sessionId}`)(),
      transcript: ({ sessionId }) => {
        calls.push(`transcript ${sessionId}`);
        return Promise.resolve({ segments: [{ startMs: 0, endMs: 1000, text: sessionId }] });
      },
    },
    notes: {
      draft: ({ sessionId }) => {
        calls.push(`draft ${sessionId}`);
        return Promise.resolve({ draft: { ...DRAFT, sessionId } });
      },
      save: ({ sessionId, note }) => {
        calls.push(`save ${sessionId} ${note.title}`);
        return failSave ? Promise.reject(failSave) : Promise.resolve({ noteId: 'n1' });
      },
    },
    on: (event, listener) => {
      listeners.set(event, listener);
      return () => listeners.delete(event);
    },
  };
  const emit = <E extends IpcEvent>(event: E, payload: IpcEventPayload<E>) => {
    listeners.get(event)?.(payload as never);
  };
  return {
    api,
    calls,
    emit,
    listeners,
    failNextSave: (error: Error) => {
      failSave = error;
    },
  };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const setup = () => {
  const fake = fakeApi();
  const { store, connect } = createSessionStore(fake.api);
  const disconnect = connect();
  const state = (sessionId: string, s: IpcEventPayload<'session:state'>['state'], error = null) => {
    fake.emit('session:state', { sessionId, state: s, error });
  };
  return { ...fake, store, disconnect, state };
};

describe('session store', () => {
  it('mirrors session state and the level meter while listening', () => {
    const { store, emit, state } = setup();
    state('s1', 'LISTENING');
    emit('capture:level', { dbfs: -12 });
    expect(store.getState()).toMatchObject({ session: { state: 'LISTENING' }, levelDbfs: -12 });

    state('s1', 'STOPPING');
    expect(store.getState().levelDbfs).toBeUndefined();
  });

  it('loads the transcript once it exists, and the draft in REVIEW', async () => {
    const { store, calls, state } = setup();
    state('s1', 'TRANSCRIBING');
    await flush();
    expect(store.getState().transcript).toEqual([{ startMs: 0, endMs: 1000, text: 's1' }]);
    expect(store.getState().draft).toBeNull();

    state('s1', 'REVIEW');
    await flush();
    expect(store.getState().draft?.sessionId).toBe('s1');
    expect(calls).toEqual(['transcript s1', 'transcript s1', 'draft s1']);
  });

  it('drops the draft when the session leaves REVIEW, and the transcript for a new session', async () => {
    const { store, state } = setup();
    state('s1', 'REVIEW');
    await flush();

    state('s1', 'SAVED');
    expect(store.getState().draft).toBeNull();
    expect(store.getState().transcript).toHaveLength(1);

    state('s2', 'STARTING');
    expect(store.getState().transcript).toEqual([]);
  });

  it('ignores a late reply for a session that is no longer current', async () => {
    const { store, state } = setup();
    state('s1', 'REVIEW');
    state('s2', 'STARTING');
    await flush();
    expect(store.getState().draft).toBeNull();
    expect(store.getState().transcript).toEqual([]);
  });

  it('sends intents for the current session', async () => {
    const { store, calls, state } = setup();
    store.getState().retry(); // no session yet: nothing to send
    state('s1', 'GENERATING', null);
    await flush();
    calls.length = 0;

    store.getState().retry();
    store.getState().discard();
    store.getState().pause();
    await flush();
    expect(calls).toEqual(['retry s1', 'discard s1', 'pause']);
  });

  it('saves once at a time and reports a failure in plain language', async () => {
    const { store, calls, state, failNextSave } = setup();
    state('s1', 'REVIEW');
    await flush();
    calls.length = 0;
    failNextSave(
      new Error(
        "Error invoking remote method 'notes:save': Error: This session has no note to save.",
      ),
    );
    const edits = { title: 'T', summary: 'S', keyPoints: [], tags: [] };

    store.getState().save(edits);
    store.getState().save(edits);
    expect(store.getState().isSaving).toBe(true);
    await flush();

    expect(calls).toEqual(['save s1 T']);
    expect(store.getState()).toMatchObject({
      isSaving: false,
      actionError: 'This session has no note to save.',
    });
  });

  it('stops listening when disconnected', () => {
    const { listeners, disconnect } = setup();
    disconnect();
    expect(listeners.size).toBe(0);
  });
});

describe('errorMessage', () => {
  it('strips the IPC wrapper', () => {
    expect(errorMessage(new Error("Error invoking remote method 'x:y': TypeError: bad"))).toBe(
      'bad',
    );
    expect(errorMessage('plain')).toBe('plain');
  });
});
