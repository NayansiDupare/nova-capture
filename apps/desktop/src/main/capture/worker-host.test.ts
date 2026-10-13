import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MainToWorker } from '@nova/core';

import { log } from '../log';
import { WorkerHost } from './worker-host';
import type { WorkerProcess } from './worker-host';

/** A scripted worker process: the test decides every reply. */
class ScriptedProcess implements WorkerProcess<string> {
  readonly posted: { message: MainToWorker; transfer: string[] | undefined }[] = [];
  // Typed loosely here; the public overloads pair each event with its listener type.
  private onMessage: (value: never) => void = () => undefined;
  private onExit: (value: never) => void = () => undefined;

  postMessage(message: MainToWorker, transfer?: string[]): void {
    this.posted.push({ message, transfer });
  }

  on(event: 'message', listener: (message: unknown) => void): void;
  on(event: 'exit', listener: (code: number) => void): void;
  on(event: 'message' | 'exit', listener: (value: never) => void): void {
    if (event === 'message') this.onMessage = listener;
    else this.onExit = listener;
  }

  reply(message: unknown): void {
    this.onMessage(message as never);
  }

  exit(code: number): void {
    this.onExit(code as never);
  }

  lastRequestId(): string {
    const last = this.posted.at(-1)?.message;
    return last?.type === 'analyze' ? last.requestId : '';
  }
}

let processes: ScriptedProcess[];
let levels: [string, number][];
let captureErrors: [string, string][];
let host: WorkerHost<string>;

beforeEach(() => {
  vi.spyOn(log, 'warn').mockImplementation(() => undefined);
  processes = [];
  levels = [];
  captureErrors = [];
  host = new WorkerHost<string>({
    spawn: () => {
      const process = new ScriptedProcess();
      processes.push(process);
      return process;
    },
    onLevel: (sessionId, dbfs) => levels.push([sessionId, dbfs]),
    onCaptureError: (sessionId, message) => captureErrors.push([sessionId, message]),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const worker = () => {
  const process = processes.at(-1);
  if (!process) throw new Error('No worker spawned');
  return process;
};

describe('WorkerHost', () => {
  it('spawns lazily and hands the frame port to the worker on start', async () => {
    expect(processes).toHaveLength(0);
    const started = host.start('s1', '/spool/s1.pcm', 'port-1');
    expect(worker().posted[0]).toEqual({
      message: { type: 'start', sessionId: 's1', spoolPath: '/spool/s1.pcm' },
      transfer: ['port-1'],
    });
    worker().reply({ type: 'started', sessionId: 's1' });
    await expect(started).resolves.toBeUndefined();
  });

  it('rejects start when the worker cannot open the spool', async () => {
    const started = host.start('s1', '/spool/s1.pcm', 'port-1');
    worker().reply({ type: 'error', sessionId: 's1', message: 'Cannot open spool: EACCES' });
    await expect(started).rejects.toThrow('Cannot open spool: EACCES');
    // Nothing is capturing, so stop resolves at once.
    await expect(host.stop()).resolves.toEqual({ bytesWritten: 0, droppedFrames: 0 });
  });

  it('forwards levels and resolves stop with the spool size', async () => {
    const started = host.start('s1', '/p', 'port');
    worker().reply({ type: 'started', sessionId: 's1' });
    await started;
    worker().reply({ type: 'level', sessionId: 's1', dbfs: -12 });

    const stopped = host.stop();
    worker().reply({ type: 'stopped', sessionId: 's1', bytesWritten: 3200, droppedFrames: 2 });

    await expect(stopped).resolves.toEqual({ bytesWritten: 3200, droppedFrames: 2 });
    expect(levels).toEqual([['s1', -12]]);
  });

  it('reports a spool error during capture as a capture error', async () => {
    const started = host.start('s1', '/p', 'port');
    worker().reply({ type: 'started', sessionId: 's1' });
    await started;
    worker().reply({ type: 'error', sessionId: 's1', message: 'Spool write failed: ENOSPC' });
    expect(captureErrors).toEqual([['s1', 'Spool write failed: ENOSPC']]);
  });

  it('rejects stop when the final flush fails', async () => {
    const started = host.start('s1', '/p', 'port');
    worker().reply({ type: 'started', sessionId: 's1' });
    await started;
    const stopped = host.stop();
    worker().reply({ type: 'error', sessionId: 's1', message: 'Spool write failed' });
    await expect(stopped).rejects.toThrow('Spool write failed');
    expect(captureErrors).toEqual([]);
  });

  it('resolves stop after a timeout if the worker never answers', async () => {
    vi.useFakeTimers();
    const started = host.start('s1', '/p', 'port');
    worker().reply({ type: 'started', sessionId: 's1' });
    await started;
    const stopped = host.stop();
    vi.advanceTimersByTime(10_000);
    await expect(stopped).rejects.toThrow(/did not confirm stop/);
  });

  it('matches analysis replies by request id', async () => {
    const first = host.analyze('/a.pcm');
    const firstId = worker().lastRequestId();
    const second = host.analyze('/b.pcm');
    const secondId = worker().lastRequestId();

    worker().reply({
      type: 'analyzed',
      requestId: secondId,
      durationMs: 2,
      speech: [],
      speechRatio: 0,
    });
    worker().reply({ type: 'error', requestId: firstId, message: 'Cannot analyze spool: ENOENT' });

    await expect(second).resolves.toMatchObject({ durationMs: 2 });
    await expect(first).rejects.toThrow(/ENOENT/);
  });

  it('ignores malformed messages', () => {
    void host.analyze('/a.pcm');
    worker().reply({ type: 'level', dbfs: 'loud' });
    worker().reply('garbage');
    expect(levels).toEqual([]);
  });

  it('pause and resume are forwarded; before any spawn they do nothing', () => {
    host.pause();
    expect(processes).toHaveLength(0);
    void host.analyze('/a.pcm');
    host.pause();
    host.resume();
    expect(worker().posted.map((p) => p.message.type)).toEqual(['analyze', 'pause', 'resume']);
  });

  it('on a crash: fails pending work, reports the capture and respawns on next use', async () => {
    const started = host.start('s1', '/p', 'port');
    worker().reply({ type: 'started', sessionId: 's1' });
    await started;
    const analysis = host.analyze('/other.pcm');

    worker().exit(3);

    await expect(analysis).rejects.toThrow(/stopped unexpectedly \(exit code 3\)/);
    expect(captureErrors).toEqual([['s1', 'Audio worker stopped unexpectedly (exit code 3)']]);
    void host.analyze('/again.pcm');
    expect(processes).toHaveLength(2);
  });

  it('does not report a capture error for a crash during stop', async () => {
    const started = host.start('s1', '/p', 'port');
    worker().reply({ type: 'started', sessionId: 's1' });
    await started;
    const stopped = host.stop();
    worker().exit(1);
    await expect(stopped).rejects.toThrow(/stopped unexpectedly/);
    expect(captureErrors).toEqual([]);
  });
});
