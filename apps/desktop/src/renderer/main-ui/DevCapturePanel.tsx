import type { SessionState } from '@nova/core';

import { useCaptureSession } from './hooks/use-capture-session';

const ACTIVE: ReadonlySet<SessionState> = new Set(['STARTING', 'LISTENING', 'PAUSED']);
const DISCARDABLE: ReadonlySet<SessionState> = new Set([
  'LISTENING',
  'PAUSED',
  'TRANSCRIBING',
  'GENERATING',
  'REVIEW',
]);

const formatTime = (ms: number) => {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60))}:${String(total % 60).padStart(2, '0')}`;
};

/**
 * Temporary Phase 2 panel to record and see the transcript. Replaced by the Capture and
 * Review screens (Phase 3+).
 */
export function DevCapturePanel() {
  const view = useCaptureSession();
  const state = view.session?.state;
  const isActive = state !== undefined && ACTIVE.has(state);

  return (
    <section className="dev-panel" aria-labelledby="dev-panel-title">
      <h2 id="dev-panel-title">Capture (developer preview)</h2>

      <p role="status" aria-live="polite" className="dev-panel__status">
        {state === 'LISTENING' && <span className="dev-panel__rec-dot" aria-hidden="true" />}
        {state === undefined ? 'Idle' : `State: ${state}`}
        {view.session?.error && <span className="dev-panel__error"> · {view.session.error}</span>}
      </p>

      {state === 'LISTENING' && (
        <label className="dev-panel__meter">
          Level
          <meter min={-60} max={0} value={view.levelDbfs ?? -60} />
        </label>
      )}

      <div className="dev-panel__actions">
        <button type="button" onClick={view.start} disabled={isActive}>
          Start
        </button>
        <button type="button" onClick={view.stop} disabled={!isActive}>
          Stop
        </button>
        {state === 'PAUSED' ? (
          <button type="button" onClick={view.resume}>
            Resume
          </button>
        ) : (
          <button type="button" onClick={view.pause} disabled={state !== 'LISTENING'}>
            Pause
          </button>
        )}
        <button
          type="button"
          onClick={view.retry}
          disabled={!(state === 'TRANSCRIBING' && view.session?.error)}
        >
          Retry
        </button>
        <button
          type="button"
          className="dev-panel__danger"
          onClick={view.discard}
          disabled={state === undefined || !DISCARDABLE.has(state)}
        >
          Discard
        </button>
      </div>

      {view.actionError && (
        <p role="alert" className="dev-panel__error">
          {view.actionError}
        </p>
      )}

      {view.transcript.length > 0 && (
        <ol className="dev-panel__transcript" aria-label="Transcript">
          {view.transcript.map((segment) => (
            <li key={`${String(segment.startMs)}-${String(segment.endMs)}`}>
              <time className="dev-panel__time">{formatTime(segment.startMs)}</time> {segment.text}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
