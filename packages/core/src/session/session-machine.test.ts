import { describe, expect, it } from 'vitest';

import {
  INITIAL_SNAPSHOT,
  InvalidTransitionError,
  isTerminalState,
  reduce,
  SESSION_STATES,
  TERMINAL_STATES,
} from './session-machine';
import type { SessionEvent, SessionSnapshot, SessionState } from './session-machine';

const at = (state: SessionState, error: string | null = null): SessionSnapshot => ({
  state,
  error,
});

const EVENTS: readonly SessionEvent[] = [
  { type: 'start' },
  { type: 'started' },
  { type: 'startFailed', error: 'Screen capture permission denied' },
  { type: 'cancel' },
  { type: 'pause' },
  { type: 'resume' },
  { type: 'stop' },
  { type: 'captureLost', error: 'Audio device disconnected' },
  { type: 'stopped' },
  { type: 'transcribed' },
  { type: 'transcribeFailed', error: 'Network unavailable' },
  { type: 'generated' },
  { type: 'generateFailed', error: 'Note did not match the schema' },
  { type: 'retry' },
  { type: 'save' },
  { type: 'discard' },
];

const event = (type: SessionEvent['type']): SessionEvent => {
  const found = EVENTS.find((e) => e.type === type);
  if (!found) throw new Error(`No sample event for ${type}`);
  return found;
};

/** Every allowed transition from a snapshot without an error: [from, event, to, error after]. */
const VALID: readonly [SessionState, SessionEvent['type'], SessionState, string | null][] = [
  ['IDLE', 'start', 'STARTING', null],
  ['STARTING', 'started', 'LISTENING', null],
  ['STARTING', 'startFailed', 'FAILED', 'Screen capture permission denied'],
  ['STARTING', 'cancel', 'DISCARDED', null],
  ['LISTENING', 'pause', 'PAUSED', null],
  ['LISTENING', 'stop', 'STOPPING', null],
  ['LISTENING', 'captureLost', 'STOPPING', 'Audio device disconnected'],
  ['LISTENING', 'discard', 'DISCARDED', null],
  ['PAUSED', 'resume', 'LISTENING', null],
  ['PAUSED', 'stop', 'STOPPING', null],
  ['PAUSED', 'captureLost', 'STOPPING', 'Audio device disconnected'],
  ['PAUSED', 'discard', 'DISCARDED', null],
  ['STOPPING', 'stopped', 'TRANSCRIBING', null],
  ['TRANSCRIBING', 'transcribed', 'GENERATING', null],
  ['TRANSCRIBING', 'transcribeFailed', 'TRANSCRIBING', 'Network unavailable'],
  ['TRANSCRIBING', 'discard', 'DISCARDED', null],
  ['GENERATING', 'generated', 'REVIEW', null],
  ['GENERATING', 'generateFailed', 'GENERATING', 'Note did not match the schema'],
  ['GENERATING', 'discard', 'DISCARDED', null],
  ['REVIEW', 'save', 'SAVED', null],
  ['REVIEW', 'discard', 'DISCARDED', null],
];

describe('session state machine', () => {
  describe('valid transitions', () => {
    it.each(VALID)('%s --%s--> %s', (from, type, to, error) => {
      expect(reduce(at(from), event(type))).toEqual({ state: to, error });
    });

    it('does not mutate the input snapshot', () => {
      const snapshot = at('LISTENING');
      reduce(snapshot, { type: 'stop' });
      expect(snapshot).toEqual(at('LISTENING'));
    });
  });

  describe('invalid transitions', () => {
    const invalid = SESSION_STATES.flatMap((state) =>
      EVENTS.filter((e) => !VALID.some(([from, type]) => from === state && type === e.type)).map(
        (e) => [state, e.type] as const,
      ),
    );

    it.each(invalid)('rejects %s in %s', (state, type) => {
      expect(() => reduce(at(state), event(type))).toThrow(InvalidTransitionError);
    });

    it('rejects stop while IDLE with a descriptive error', () => {
      expect(() => reduce(INITIAL_SNAPSHOT, { type: 'stop' })).toThrow(
        /invalid transition: 'stop' in state IDLE/i,
      );
    });

    it('exposes the state and event on the error', () => {
      const error = (() => {
        try {
          reduce(at('SAVED'), { type: 'discard' });
        } catch (e) {
          return e;
        }
        return undefined;
      })();
      expect(error).toBeInstanceOf(InvalidTransitionError);
      expect(error).toMatchObject({ state: 'SAVED', eventType: 'discard' });
    });
  });

  describe('retryable failures', () => {
    it.each(['TRANSCRIBING', 'GENERATING'] as const)(
      'retry in %s clears the error and stays in the same state',
      (state) => {
        expect(reduce(at(state, 'boom'), { type: 'retry' })).toEqual(at(state));
      },
    );

    it.each(['TRANSCRIBING', 'GENERATING'] as const)(
      'rejects retry in %s without an error',
      (state) => {
        expect(() => reduce(at(state), { type: 'retry' })).toThrow(InvalidTransitionError);
      },
    );

    it('rejects completing transcription before the failure is retried', () => {
      expect(() => reduce(at('TRANSCRIBING', 'boom'), { type: 'transcribed' })).toThrow(
        InvalidTransitionError,
      );
    });

    it('rejects completing generation before the failure is retried', () => {
      expect(() => reduce(at('GENERATING', 'boom'), { type: 'generated' })).toThrow(
        InvalidTransitionError,
      );
    });

    it('records a repeated failure with the latest message', () => {
      const next = reduce(at('TRANSCRIBING', 'first'), {
        type: 'transcribeFailed',
        error: 'second',
      });
      expect(next).toEqual(at('TRANSCRIBING', 'second'));
    });

    it('allows discarding a failed session', () => {
      expect(reduce(at('GENERATING', 'boom'), { type: 'discard' })).toEqual(at('DISCARDED'));
    });

    it('clears a capture-lost error once the spool is final', () => {
      const stopping = reduce(at('LISTENING'), { type: 'captureLost', error: 'Disk full' });
      expect(reduce(stopping, { type: 'stopped' })).toEqual(at('TRANSCRIBING'));
    });
  });

  describe('terminal states', () => {
    it.each(SESSION_STATES)('classifies %s', (state) => {
      expect(isTerminalState(state)).toBe(
        (TERMINAL_STATES as readonly SessionState[]).includes(state),
      );
    });

    it.each(TERMINAL_STATES)('accepts no event in %s', (state) => {
      for (const e of EVENTS) {
        expect(() => reduce(at(state), e)).toThrow(InvalidTransitionError);
      }
    });
  });

  // ARCHITECTURE.md §8: a session found in a non-terminal state at launch can always be finished.
  describe('recovery from each non-terminal state', () => {
    const run = (from: SessionSnapshot, events: readonly SessionEvent['type'][]) =>
      events.reduce((snapshot, type) => reduce(snapshot, event(type)), from);

    const RECOVERY: readonly [SessionSnapshot, readonly SessionEvent['type'][]][] = [
      [at('STARTING'), ['cancel']],
      [at('LISTENING'), ['captureLost', 'stopped', 'transcribed', 'generated', 'save']],
      [at('PAUSED'), ['captureLost', 'stopped', 'transcribed', 'generated', 'save']],
      [at('STOPPING'), ['stopped', 'transcribed', 'generated', 'save']],
      [at('TRANSCRIBING'), ['transcribed', 'generated', 'save']],
      [at('TRANSCRIBING', 'Network unavailable'), ['retry', 'transcribed', 'generated', 'save']],
      [at('GENERATING'), ['generated', 'save']],
      [at('GENERATING', 'Invalid note'), ['retry', 'generated', 'save']],
      [at('REVIEW'), ['save']],
    ];

    it('covers every non-terminal state except IDLE', () => {
      const covered = new Set(RECOVERY.map(([snapshot]) => snapshot.state));
      const expected = SESSION_STATES.filter((s) => s !== 'IDLE' && !isTerminalState(s));
      expect([...covered].sort()).toEqual([...expected].sort());
    });

    it.each(RECOVERY)('finishes from %o', (from, events) => {
      expect(isTerminalState(run(from, events).state)).toBe(true);
    });
  });
});
