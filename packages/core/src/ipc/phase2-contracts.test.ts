import { describe, expect, it } from 'vitest';

import { CaptureHostEndedSchema } from './capture-host';
import { IPC_CHANNELS, IPC_EVENTS } from './channels';
import { MainToWorkerSchema, WorkerToMainSchema } from './worker-protocol';

const accepts = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) =>
  schema.safeParse(value).success;

describe('capture and session channels', () => {
  it.each(['capture:start', 'capture:stop', 'capture:pause', 'capture:resume'] as const)(
    '%s takes no payload',
    (channel) => {
      expect(accepts(IPC_CHANNELS[channel].request, undefined)).toBe(true);
      expect(accepts(IPC_CHANNELS[channel].request, { sessionId: 's1' })).toBe(false);
    },
  );

  it('capture:start returns only a session id', () => {
    const { response } = IPC_CHANNELS['capture:start'];
    expect(accepts(response, { sessionId: 'abc' })).toBe(true);
    expect(accepts(response, { sessionId: '' })).toBe(false);
    expect(accepts(response, { sessionId: 'abc', spoolPath: 'C:/x.pcm' })).toBe(false);
  });

  it.each(['sessions:retry', 'sessions:discard', 'sessions:transcript'] as const)(
    '%s needs exactly a session id',
    (channel) => {
      const { request } = IPC_CHANNELS[channel];
      expect(accepts(request, { sessionId: 's1' })).toBe(true);
      expect(accepts(request, {})).toBe(false);
      expect(accepts(request, { sessionId: 'x'.repeat(101) })).toBe(false);
      expect(accepts(request, { sessionId: 's1', force: true })).toBe(false);
    },
  );

  it('sessions:transcript returns timed segments', () => {
    const { response } = IPC_CHANNELS['sessions:transcript'];
    expect(accepts(response, { segments: [{ startMs: 0, endMs: 900, text: 'Hi' }] })).toBe(true);
    expect(accepts(response, { segments: [{ startMs: -1, endMs: 900, text: 'Hi' }] })).toBe(false);
  });
});

describe('main → UI events', () => {
  it('session:state carries a known state and nullable error', () => {
    const schema = IPC_EVENTS['session:state'];
    expect(accepts(schema, { sessionId: 's1', state: 'LISTENING', error: null })).toBe(true);
    expect(accepts(schema, { sessionId: 's1', state: 'WARPING', error: null })).toBe(false);
    expect(accepts(schema, { sessionId: 's1', state: 'FAILED' })).toBe(false);
  });

  it('capture:level carries a finite number', () => {
    expect(accepts(IPC_EVENTS['capture:level'], { dbfs: -23.5 })).toBe(true);
    expect(accepts(IPC_EVENTS['capture:level'], { dbfs: Number.NEGATIVE_INFINITY })).toBe(false);
  });
});

describe('worker protocol', () => {
  it.each([
    { type: 'start', sessionId: 's1', spoolPath: '/spool/s1.pcm' },
    { type: 'pause' },
    { type: 'resume' },
    { type: 'stop' },
    { type: 'analyze', requestId: 'r1', spoolPath: '/spool/s1.pcm' },
  ])('main → worker accepts %o', (message) => {
    expect(accepts(MainToWorkerSchema, message)).toBe(true);
  });

  it.each([{ type: 'start', sessionId: 's1' }, { type: 'delete', spoolPath: '/x' }, null])(
    'main → worker rejects %o',
    (message) => {
      expect(accepts(MainToWorkerSchema, message)).toBe(false);
    },
  );

  it.each([
    { type: 'started', sessionId: 's1' },
    { type: 'level', sessionId: 's1', dbfs: -100 },
    { type: 'stopped', sessionId: 's1', bytesWritten: 3200, droppedFrames: 0 },
    {
      type: 'analyzed',
      requestId: 'r1',
      durationMs: 5000,
      speech: [{ startMs: 0, endMs: 900 }],
      speechRatio: 0.18,
    },
    { type: 'error', message: 'Spool write failed', sessionId: 's1' },
  ])('worker → main accepts %o', (message) => {
    expect(accepts(WorkerToMainSchema, message)).toBe(true);
  });

  it.each([
    { type: 'stopped', sessionId: 's1', bytesWritten: -1, droppedFrames: 0 },
    { type: 'analyzed', requestId: 'r1', durationMs: 5000, speech: [], speechRatio: 1.5 },
    { type: 'level', sessionId: 's1', dbfs: 'loud' },
  ])('worker → main rejects %o', (message) => {
    expect(accepts(WorkerToMainSchema, message)).toBe(false);
  });
});

describe('capture host messages', () => {
  it('capture-host:ended needs a short reason', () => {
    expect(accepts(CaptureHostEndedSchema, { reason: 'The system audio stream ended' })).toBe(true);
    expect(accepts(CaptureHostEndedSchema, { reason: '' })).toBe(false);
    expect(accepts(CaptureHostEndedSchema, { reason: 'x'.repeat(501) })).toBe(false);
    expect(accepts(CaptureHostEndedSchema, { reason: 'ok', extra: 1 })).toBe(false);
  });
});
