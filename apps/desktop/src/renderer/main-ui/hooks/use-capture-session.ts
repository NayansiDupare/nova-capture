import { useCallback, useEffect, useState } from 'react';

import type { IpcEventPayload, SessionState } from '@nova/core';

type Segment = { startMs: number; endMs: number; text: string };

export type CaptureSessionView = {
  readonly session: IpcEventPayload<'session:state'> | undefined;
  readonly levelDbfs: number | undefined;
  readonly transcript: readonly Segment[];
  readonly actionError: string | undefined;
  readonly start: () => void;
  readonly stop: () => void;
  readonly pause: () => void;
  readonly resume: () => void;
  readonly retry: () => void;
  readonly discard: () => void;
  readonly loadTranscript: () => void;
};

/** States after which a transcript (complete or partial) can be shown. */
const HAS_TRANSCRIPT: ReadonlySet<SessionState> = new Set(['TRANSCRIBING', 'GENERATING', 'REVIEW']);

/**
 * Mirrors the latest session's state from main and exposes intents (CODE_STYLE.md §8:
 * no business logic in components). A Zustand store replaces this with the real UI.
 */
export function useCaptureSession(): CaptureSessionView {
  const [session, setSession] = useState<IpcEventPayload<'session:state'>>();
  const [levelDbfs, setLevelDbfs] = useState<number>();
  const [transcript, setTranscript] = useState<readonly Segment[]>([]);
  const [actionError, setActionError] = useState<string>();

  useEffect(() => {
    const offState = window.nova.on('session:state', (payload) => {
      setSession(payload);
      if (payload.state !== 'LISTENING') setLevelDbfs(undefined);
      if (HAS_TRANSCRIPT.has(payload.state)) {
        fetchTranscript(payload.sessionId).then(setTranscript, (error: unknown) => {
          setActionError(errorMessage(error));
        });
      }
    });
    const offLevel = window.nova.on('capture:level', ({ dbfs }) => {
      setLevelDbfs(dbfs);
    });
    return () => {
      offState();
      offLevel();
    };
  }, []);

  const run = useCallback((action: () => Promise<unknown>) => {
    setActionError(undefined);
    action().catch((error: unknown) => {
      setActionError(errorMessage(error));
    });
  }, []);

  const sessionId = session?.sessionId;
  const loadTranscript = useCallback(() => {
    if (sessionId === undefined) return;
    run(async () => {
      setTranscript(await fetchTranscript(sessionId));
    });
  }, [run, sessionId]);

  return {
    session,
    levelDbfs,
    transcript,
    actionError,
    start: () => {
      setTranscript([]);
      run(() => window.nova.capture.start());
    },
    stop: () => {
      run(() => window.nova.capture.stop());
    },
    pause: () => {
      run(() => window.nova.capture.pause());
    },
    resume: () => {
      run(() => window.nova.capture.resume());
    },
    retry: () => {
      if (sessionId !== undefined) run(() => window.nova.sessions.retry({ sessionId }));
    },
    discard: () => {
      if (sessionId !== undefined) run(() => window.nova.sessions.discard({ sessionId }));
    },
    loadTranscript,
  };
}

async function fetchTranscript(sessionId: string): Promise<readonly Segment[]> {
  return (await window.nova.sessions.transcript({ sessionId })).segments;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
