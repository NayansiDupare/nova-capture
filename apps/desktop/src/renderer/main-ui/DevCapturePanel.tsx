import type { SessionState } from '@nova/core';

import { formatTime } from './format-time';
import { useSessionStore } from './stores/use-session-store';
import { VocabularyEditor } from './VocabularyEditor';

const ACTIVE: ReadonlySet<SessionState> = new Set(['STARTING', 'LISTENING', 'PAUSED']);
const RETRYABLE: ReadonlySet<SessionState> = new Set(['TRANSCRIBING', 'GENERATING']);
const DISCARDABLE: ReadonlySet<SessionState> = new Set([
  'LISTENING',
  'PAUSED',
  'TRANSCRIBING',
  'GENERATING',
  'REVIEW',
]);

/**
 * Temporary developer panel to record and see the transcript. Replaced by the Home and
 * Capture screens; the Review screen takes over once a note is generated.
 */
export function DevCapturePanel() {
  const session = useSessionStore((s) => s.session);
  const levelDbfs = useSessionStore((s) => s.levelDbfs);
  const transcript = useSessionStore((s) => s.transcript);
  const actionError = useSessionStore((s) => s.actionError);
  const start = useSessionStore((s) => s.start);
  const stop = useSessionStore((s) => s.stop);
  const pause = useSessionStore((s) => s.pause);
  const resume = useSessionStore((s) => s.resume);
  const retry = useSessionStore((s) => s.retry);
  const discard = useSessionStore((s) => s.discard);
  const state = session?.state;
  const isActive = state !== undefined && ACTIVE.has(state);

  return (
    <section className="dev-panel" aria-labelledby="dev-panel-title">
      <h2 id="dev-panel-title">Capture (developer preview)</h2>

      <p role="status" aria-live="polite" className="dev-panel__status">
        {state === 'LISTENING' && <span className="dev-panel__rec-dot" aria-hidden="true" />}
        {state === undefined ? 'Idle' : state === 'SAVED' ? 'Note saved' : `State: ${state}`}
        {session?.error && <span className="dev-panel__error"> · {session.error}</span>}
      </p>

      {state === 'LISTENING' && (
        <label className="dev-panel__meter">
          Level
          <meter min={-60} max={0} value={levelDbfs ?? -60} />
        </label>
      )}

      <div className="dev-panel__actions">
        <button type="button" onClick={start} disabled={isActive}>
          Start
        </button>
        <button type="button" onClick={stop} disabled={!isActive}>
          Stop
        </button>
        {state === 'PAUSED' ? (
          <button type="button" onClick={resume}>
            Resume
          </button>
        ) : (
          <button type="button" onClick={pause} disabled={state !== 'LISTENING'}>
            Pause
          </button>
        )}
        <button
          type="button"
          onClick={retry}
          disabled={!(state !== undefined && RETRYABLE.has(state) && session?.error)}
        >
          Retry
        </button>
        <button
          type="button"
          className="dev-panel__danger"
          onClick={discard}
          disabled={state === undefined || !DISCARDABLE.has(state)}
        >
          Discard
        </button>
      </div>

      {actionError && (
        <p role="alert" className="dev-panel__error">
          {actionError}
        </p>
      )}

      <VocabularyEditor />

      {transcript.length > 0 && (
        <ol className="dev-panel__transcript" aria-label="Transcript">
          {transcript.map((segment) => (
            <li key={`${String(segment.startMs)}-${String(segment.endMs)}`}>
              <time className="dev-panel__time">{formatTime(segment.startMs)}</time> {segment.text}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
