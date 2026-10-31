import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';

import type { IpcEventPayload, IpcResponse, NoteDraft, NoteEdits, SessionState } from '@nova/core';

import type { NovaApi, Unsubscribe } from '../../../preload/api';

export type SessionApi = Pick<NovaApi, 'capture' | 'sessions' | 'notes' | 'on'>;

export type Segment = IpcResponse<'sessions:transcript'>['segments'][number];

export type SessionStoreState = {
  readonly session: IpcEventPayload<'session:state'> | undefined;
  readonly levelDbfs: number | undefined;
  readonly transcript: readonly Segment[];
  /** The generated note while the session is in REVIEW. */
  readonly draft: NoteDraft | null;
  readonly isSaving: boolean;
  /** The last intent that failed, in plain language. */
  readonly actionError: string | undefined;
  readonly start: () => void;
  readonly stop: () => void;
  readonly pause: () => void;
  readonly resume: () => void;
  readonly retry: () => void;
  readonly discard: () => void;
  readonly loadTranscript: () => void;
  readonly save: (edits: NoteEdits) => void;
};

/** States after which a transcript (complete or partial) can be shown. */
const HAS_TRANSCRIPT: ReadonlySet<SessionState> = new Set(['TRANSCRIBING', 'GENERATING', 'REVIEW']);

/**
 * Mirrors the latest session from main and turns UI actions into IPC intents
 * (CODE_STYLE.md §8). Main owns every decision; this only stores what it reports.
 */
export function createSessionStore(api: SessionApi): {
  store: StoreApi<SessionStoreState>;
  connect: () => Unsubscribe;
} {
  const store = createStore<SessionStoreState>()((set, get) => {
    const run = (action: () => Promise<unknown>) => {
      set({ actionError: undefined });
      action().catch((error: unknown) => {
        set({ actionError: errorMessage(error) });
      });
    };
    const withSession = (action: (sessionId: string) => Promise<unknown>) => {
      const sessionId = get().session?.sessionId;
      if (sessionId !== undefined) run(() => action(sessionId));
    };

    return {
      session: undefined,
      levelDbfs: undefined,
      transcript: [],
      draft: null,
      isSaving: false,
      actionError: undefined,
      start: () => {
        set({ transcript: [], draft: null });
        run(() => api.capture.start());
      },
      stop: () => {
        run(() => api.capture.stop());
      },
      pause: () => {
        run(() => api.capture.pause());
      },
      resume: () => {
        run(() => api.capture.resume());
      },
      retry: () => {
        withSession((sessionId) => api.sessions.retry({ sessionId }));
      },
      discard: () => {
        withSession((sessionId) => api.sessions.discard({ sessionId }));
      },
      loadTranscript: () => {
        withSession(async (sessionId) => {
          const { segments } = await api.sessions.transcript({ sessionId });
          if (get().session?.sessionId === sessionId) set({ transcript: segments });
        });
      },
      save: (edits) => {
        const sessionId = get().session?.sessionId;
        if (sessionId === undefined || get().isSaving) return;
        set({ isSaving: true });
        run(async () => {
          try {
            await api.notes.save({ sessionId, note: edits });
          } finally {
            set({ isSaving: false });
          }
        });
      },
    };
  });

  /** Fetches into the store unless another session has taken over in the meantime. */
  const loadFor = async (sessionId: string, state: SessionState) => {
    const isCurrent = () => store.getState().session?.sessionId === sessionId;
    try {
      if (HAS_TRANSCRIPT.has(state)) {
        const { segments } = await api.sessions.transcript({ sessionId });
        if (isCurrent()) store.setState({ transcript: segments });
      }
      if (state === 'REVIEW') {
        const { draft } = await api.notes.draft({ sessionId });
        if (isCurrent()) store.setState({ draft });
      }
    } catch (error) {
      store.setState({ actionError: errorMessage(error) });
    }
  };

  const connect = () => {
    const offState = api.on('session:state', (payload) => {
      const isNewSession = store.getState().session?.sessionId !== payload.sessionId;
      store.setState({
        session: payload,
        ...(payload.state === 'LISTENING' ? {} : { levelDbfs: undefined }),
        ...(payload.state === 'REVIEW' ? {} : { draft: null }),
        ...(isNewSession ? { transcript: [] } : {}),
      });
      void loadFor(payload.sessionId, payload.state);
    });
    const offLevel = api.on('capture:level', ({ dbfs }) => {
      store.setState({ levelDbfs: dbfs });
    });
    return () => {
      offState();
      offLevel();
    };
  };

  return { store, connect };
}

/** IPC errors arrive as "Error invoking remote method '…': Error: message"; keep the message. */
export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/u, '');
}
