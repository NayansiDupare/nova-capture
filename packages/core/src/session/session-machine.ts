import { z } from 'zod';

/**
 * Every state a capture session can be in (ARCHITECTURE.md §8).
 * `IDLE` means "no session yet"; the orchestrator persists a row from `STARTING` onwards.
 */
export const SESSION_STATES = [
  'IDLE',
  'STARTING',
  'LISTENING',
  'PAUSED',
  'STOPPING',
  'TRANSCRIBING',
  'GENERATING',
  'REVIEW',
  'SAVED',
  'DISCARDED',
  'FAILED',
] as const;

export const SessionStateSchema = z.enum(SESSION_STATES);
export type SessionState = z.infer<typeof SessionStateSchema>;

/** States a session never leaves. Spool and transcript may only be cleaned up after `SAVED`. */
export const TERMINAL_STATES = [
  'SAVED',
  'DISCARDED',
  'FAILED',
] as const satisfies readonly SessionState[];

/** States the user can discard from: everything after start-up that is not yet terminal, except `STOPPING`. */
const DISCARDABLE_STATES = [
  'LISTENING',
  'PAUSED',
  'TRANSCRIBING',
  'GENERATING',
  'REVIEW',
] as const satisfies readonly SessionState[];

/**
 * The reducer's state. `error` holds a plain-language message for the latest failure.
 * Failure events set it; every other transition clears it.
 */
export const SessionSnapshotSchema = z.object({
  state: SessionStateSchema,
  error: z.string().nullable(),
});
export type SessionSnapshot = z.infer<typeof SessionSnapshotSchema>;

export const INITIAL_SNAPSHOT: SessionSnapshot = { state: 'IDLE', error: null };

export type SessionEvent =
  | { type: 'start' }
  | { type: 'started' }
  | { type: 'startFailed'; error: string }
  | { type: 'cancel' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  /** Capture ended unexpectedly (device lost, disk full). Keeps the audio so far, like `stop`. */
  | { type: 'captureLost'; error: string }
  /** The worker has flushed and the spool file is final. */
  | { type: 'stopped' }
  | { type: 'transcribed' }
  /** Retries are exhausted. The session stays in `TRANSCRIBING` so nothing is lost. */
  | { type: 'transcribeFailed'; error: string }
  | { type: 'generated' }
  /** Generation failed after the repair call. The session stays in `GENERATING`. */
  | { type: 'generateFailed'; error: string }
  /** Clears a transcription or generation failure so the job can run again. */
  | { type: 'retry' }
  | { type: 'save' }
  | { type: 'discard' };

export type SessionEventType = SessionEvent['type'];

export class InvalidTransitionError extends Error {
  constructor(
    readonly state: SessionState,
    readonly eventType: SessionEventType,
  ) {
    super(`Invalid transition: '${eventType}' in state ${state}`);
    this.name = 'InvalidTransitionError';
  }
}

/** True for states a session never leaves. */
export function isTerminalState(state: SessionState): boolean {
  return (TERMINAL_STATES as readonly SessionState[]).includes(state);
}

/**
 * Applies `event` to `snapshot` and returns the next snapshot.
 *
 * @throws {InvalidTransitionError} when the event is not allowed in the current state.
 */
export function reduce(snapshot: SessionSnapshot, event: SessionEvent): SessionSnapshot {
  const next = nextSnapshot(snapshot, event);
  if (!next) {
    throw new InvalidTransitionError(snapshot.state, event.type);
  }
  return next;
}

function nextSnapshot(
  { state, error }: SessionSnapshot,
  event: SessionEvent,
): SessionSnapshot | undefined {
  const from = (
    allowed: readonly SessionState[],
    to: SessionState,
    nextError: string | null = null,
  ) => (allowed.includes(state) ? { state: to, error: nextError } : undefined);

  switch (event.type) {
    case 'start':
      return from(['IDLE'], 'STARTING');
    case 'started':
      return from(['STARTING'], 'LISTENING');
    case 'startFailed':
      return from(['STARTING'], 'FAILED', event.error);
    case 'cancel':
      return from(['STARTING'], 'DISCARDED');
    case 'pause':
      return from(['LISTENING'], 'PAUSED');
    case 'resume':
      return from(['PAUSED'], 'LISTENING');
    case 'stop':
      return from(['LISTENING', 'PAUSED'], 'STOPPING');
    case 'captureLost':
      return from(['LISTENING', 'PAUSED'], 'STOPPING', event.error);
    case 'stopped':
      return from(['STOPPING'], 'TRANSCRIBING');
    // A failed job must be retried before it can complete.
    case 'transcribed':
      return error === null ? from(['TRANSCRIBING'], 'GENERATING') : undefined;
    case 'transcribeFailed':
      return from(['TRANSCRIBING'], 'TRANSCRIBING', event.error);
    case 'generated':
      return error === null ? from(['GENERATING'], 'REVIEW') : undefined;
    case 'generateFailed':
      return from(['GENERATING'], 'GENERATING', event.error);
    case 'retry':
      return error === null ? undefined : from(['TRANSCRIBING', 'GENERATING'], state);
    case 'save':
      return from(['REVIEW'], 'SAVED');
    case 'discard':
      return from(DISCARDABLE_STATES, 'DISCARDED');
    default: {
      const _exhaustive: never = event;
      throw new Error(`Unhandled event: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
