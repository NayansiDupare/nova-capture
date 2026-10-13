import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { IpcEventPayload, MainToWorker, SpeechToTextProvider } from '@nova/core';
import { FakeAudioSource, FakeSTT } from '@nova/core/testing';

import { AudioWorker } from '../../worker/audio-worker';
import { WorkerHost } from '../capture/worker-host';
import type { WorkerProcess } from '../capture/worker-host';
import { JobsRepo } from '../db/jobs-repo';
import { openDatabase } from '../db/open-database';
import { SessionsRepo } from '../db/sessions-repo';
import { TranscriptChunksRepo } from '../db/transcript-chunks-repo';
import { UsageRepo } from '../db/usage-repo';
import { JobRunner } from '../jobs/job-runner';
import { createTranscribeChunkHandler } from '../jobs/transcribe-chunk';
import { SessionOrchestrator } from '../session/orchestrator';
import type { CaptureHostControl } from '../session/orchestrator';

/** Stand-in for a MessagePort pair: whatever the host posts reaches the worker. */
export type FakeFramePort = { deliver?: (frame: Int16Array) => void };

/**
 * Runs the real AudioWorker in-process behind the `WorkerProcess` interface. Replies are
 * delivered on a microtask, like IPC, so ordering bugs still show up.
 */
export class InProcessWorker implements WorkerProcess<FakeFramePort> {
  readonly worker: AudioWorker;
  // Typed loosely here; the public overloads pair each event with its listener type.
  private readonly messageListeners: ((value: never) => void)[] = [];
  private readonly exitListeners: ((value: never) => void)[] = [];
  private isDead = false;

  constructor(flushIntervalMs: number) {
    this.worker = new AudioWorker({
      send: (message) => {
        queueMicrotask(() => {
          if (!this.isDead)
            for (const listener of this.messageListeners) listener(message as never);
        });
      },
      flushIntervalMs,
    });
  }

  postMessage(message: MainToWorker, transfer?: FakeFramePort[]): void {
    if (this.isDead) return;
    switch (message.type) {
      case 'start': {
        const port = transfer?.[0];
        if (port) {
          port.deliver = (frame) => {
            this.worker.frame(frame);
          };
        }
        this.worker.start(message.sessionId, message.spoolPath);
        return;
      }
      case 'pause':
        this.worker.pause();
        return;
      case 'resume':
        this.worker.resume();
        return;
      case 'stop':
        this.worker.stop();
        return;
      case 'analyze':
        void this.worker.analyze(message.requestId, message.spoolPath);
        return;
    }
  }

  on(event: 'message', listener: (message: unknown) => void): void;
  on(event: 'exit', listener: (code: number) => void): void;
  on(event: 'message' | 'exit', listener: (value: never) => void): void {
    if (event === 'message') this.messageListeners.push(listener);
    else this.exitListeners.push(listener);
  }

  /** Simulates a crash: no more replies, then `exit`. Audio already flushed stays on disk. */
  crash(code = 1): void {
    this.worker.stop();
    this.isDead = true;
    for (const listener of this.exitListeners) listener(code as never);
  }
}

/** A Capture Host that plays `FakeAudioSource` audio into the frame port on demand. */
export class FakeCaptureHost implements CaptureHostControl<FakeFramePort> {
  port: FakeFramePort | undefined;
  failNextStart: Error | undefined;
  stops = 0;

  start(framePort: FakeFramePort): Promise<void> {
    if (this.failNextStart) {
      const error = this.failNextStart;
      this.failNextStart = undefined;
      return Promise.reject(error);
    }
    this.port = framePort;
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.stops++;
    this.port = undefined;
    return Promise.resolve();
  }

  /** Plays `pcm` through the frame port, as the AudioWorklet would. */
  async play(pcm: Int16Array): Promise<void> {
    const source = new FakeAudioSource(pcm);
    await source.start({ kind: 'system' }, (frame) => {
      this.port?.deliver?.(frame);
    });
  }
}

/** Lets microtask-delivered worker replies and fs work settle. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/** Polls `condition` until it holds, for asynchronous work with no promise to await. */
export async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export function createCaptureHarness(
  options: { stt?: SpeechToTextProvider; flushIntervalMs?: number } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), 'nova-orchestrator-'));
  const db = openDatabase(':memory:');
  const sessions = new SessionsRepo(db);
  const jobs = new JobsRepo(db);
  const chunks = new TranscriptChunksRepo(db);
  const usage = new UsageRepo(db);
  const captureHost = new FakeCaptureHost();
  const processes: InProcessWorker[] = [];
  const events: IpcEventPayload<'session:state'>[] = [];
  let stt = options.stt ?? new FakeSTT();
  let nextId = 0;
  let clock = 1_000_000;

  // The worker host is created first, so its callback reaches the orchestrator through a ref.
  const ref: { orchestrator?: SessionOrchestrator<FakeFramePort> } = {};
  const workerHost = new WorkerHost<FakeFramePort>({
    spawn: () => {
      const process = new InProcessWorker(options.flushIntervalMs ?? 10);
      processes.push(process);
      return process;
    },
    onLevel: () => undefined,
    onCaptureError: (sessionId, message) => {
      void ref.orchestrator?.captureLost(sessionId, message);
    },
  });
  const orchestrator = new SessionOrchestrator<FakeFramePort>({
    sessions,
    jobs,
    chunks,
    worker: workerHost,
    captureHost,
    createFramePorts: () => {
      const port: FakeFramePort = {};
      return { hostPort: port, workerPort: port };
    },
    spoolPathFor: (id) => join(dir, `${id}.pcm`),
    newId: () => `s${String(++nextId)}`,
    now: () => clock,
    emit: (event) => events.push(event),
  });
  ref.orchestrator = orchestrator;
  const runner = new JobRunner({
    jobs,
    handlers: {
      transcribe_chunk: createTranscribeChunkHandler({
        sessions,
        chunks,
        usage,
        getProvider: () => stt,
        now: () => clock,
      }),
      generate_note: () => Promise.resolve(),
    },
    now: () => clock,
    random: () => 0,
    onSettled: (job, outcome) => {
      orchestrator.onJobSettled(job, outcome);
    },
  });

  /** Runs every due job, jumping the clock to retries, until the queue is idle. */
  const drainJobs = async () => {
    for (let i = 0; i < 50; i++) {
      await runner.tick();
      const pending = jobs.listBySession('s1').concat(jobs.listBySession('s2'));
      const waiting = pending.filter((j) => j.status === 'pending');
      if (waiting.length === 0) return;
      clock = Math.min(...waiting.map((j) => j.nextRunAt ?? clock));
    }
  };

  return {
    dir,
    db,
    sessions,
    jobs,
    chunks,
    captureHost,
    processes,
    events,
    orchestrator,
    drainJobs,
    states: (sessionId = 's1') =>
      events.filter((e) => e.sessionId === sessionId).map((e) => e.state),
    useStt: (next: SpeechToTextProvider) => {
      stt = next;
    },
    cleanup: () => {
      for (const process of processes) process.worker.stop();
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
