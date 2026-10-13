import { randomUUID } from 'node:crypto';

import { WorkerToMainSchema } from '@nova/core';
import type { MainToWorker, SpeechSpan } from '@nova/core';

import { log } from '../log';

/** The part of Electron's `UtilityProcess` we use; injected so tests can run a worker in-process. */
export type WorkerProcess<P> = {
  postMessage(message: MainToWorker, transfer?: P[]): void;
  on(event: 'message', listener: (message: unknown) => void): void;
  on(event: 'exit', listener: (code: number) => void): void;
};

export type SpoolStopResult = { readonly bytesWritten: number; readonly droppedFrames: number };
export type SpoolAnalysisResult = {
  readonly durationMs: number;
  readonly speech: SpeechSpan[];
  readonly speechRatio: number;
};

type Pending<T> = { resolve: (value: T) => void; reject: (error: Error) => void };

const ANALYZE_TIMEOUT_MS = 120_000;
const STOP_TIMEOUT_MS = 10_000;

/**
 * Owns the Audio Worker process: spawns it on first use, matches replies to requests and
 * respawns it after a crash. A crash or spool error during capture is reported through
 * `onCaptureError`; the audio already flushed to the spool is kept.
 */
export class WorkerHost<P> {
  private process: WorkerProcess<P> | undefined;
  private capturingSessionId: string | undefined;
  private readonly starts = new Map<string, Pending<void>>();
  private readonly stops = new Map<string, Pending<SpoolStopResult>>();
  private readonly analyses = new Map<string, Pending<SpoolAnalysisResult>>();

  constructor(
    private readonly deps: {
      spawn: () => WorkerProcess<P>;
      onLevel: (sessionId: string, dbfs: number) => void;
      onCaptureError: (sessionId: string, message: string) => void;
    },
  ) {}

  /** Opens the spool and starts accepting frames from `framePort`. Resolves once the spool is open. */
  start(sessionId: string, spoolPath: string, framePort: P): Promise<void> {
    return new Promise((resolve, reject) => {
      this.starts.set(sessionId, { resolve, reject });
      this.capturingSessionId = sessionId;
      this.worker().postMessage({ type: 'start', sessionId, spoolPath }, [framePort]);
    });
  }

  pause(): void {
    this.process?.postMessage({ type: 'pause' });
  }

  resume(): void {
    this.process?.postMessage({ type: 'resume' });
  }

  /**
   * Flushes and closes the spool. Resolves at once if nothing is capturing (for example after
   * the worker already reported an error), and after a timeout if the worker does not answer.
   */
  stop(): Promise<SpoolStopResult> {
    const sessionId = this.capturingSessionId;
    if (sessionId === undefined || !this.process) {
      return Promise.resolve({ bytesWritten: 0, droppedFrames: 0 });
    }
    return withTimeout(
      new Promise<SpoolStopResult>((resolve, reject) => {
        this.stops.set(sessionId, { resolve, reject });
        this.process?.postMessage({ type: 'stop' });
      }),
      STOP_TIMEOUT_MS,
      () => {
        this.stops.delete(sessionId);
        this.capturingSessionId = undefined;
        return new Error('Audio worker did not confirm stop');
      },
    );
  }

  /** Reads a finished spool and returns its speech spans. */
  analyze(spoolPath: string): Promise<SpoolAnalysisResult> {
    const requestId = randomUUID();
    return withTimeout(
      new Promise<SpoolAnalysisResult>((resolve, reject) => {
        this.analyses.set(requestId, { resolve, reject });
        this.worker().postMessage({ type: 'analyze', requestId, spoolPath });
      }),
      ANALYZE_TIMEOUT_MS,
      () => {
        this.analyses.delete(requestId);
        return new Error('Spool analysis timed out');
      },
    );
  }

  private worker(): WorkerProcess<P> {
    if (this.process) {
      return this.process;
    }
    const process = this.deps.spawn();
    process.on('message', (message) => {
      this.handle(message);
    });
    process.on('exit', (code) => {
      this.handleExit(process, code);
    });
    this.process = process;
    return process;
  }

  private handle(raw: unknown): void {
    const parsed = WorkerToMainSchema.safeParse(raw);
    if (!parsed.success) {
      log.warn('ignoring invalid message from audio worker');
      return;
    }
    const message = parsed.data;
    switch (message.type) {
      case 'started':
        take(this.starts, message.sessionId)?.resolve();
        return;
      case 'level':
        this.deps.onLevel(message.sessionId, message.dbfs);
        return;
      case 'stopped':
        this.capturingSessionId = undefined;
        take(this.stops, message.sessionId)?.resolve({
          bytesWritten: message.bytesWritten,
          droppedFrames: message.droppedFrames,
        });
        if (message.droppedFrames > 0) {
          log.warn('audio frames dropped', {
            sessionId: message.sessionId,
            droppedFrames: message.droppedFrames,
          });
        }
        return;
      case 'analyzed':
        take(this.analyses, message.requestId)?.resolve({
          durationMs: message.durationMs,
          speech: message.speech,
          speechRatio: message.speechRatio,
        });
        return;
      case 'error':
        this.handleError(message.message, message.sessionId, message.requestId);
        return;
      default: {
        const _exhaustive: never = message;
        throw new Error(`Unhandled worker message: ${JSON.stringify(_exhaustive)}`);
      }
    }
  }

  private handleError(text: string, sessionId?: string, requestId?: string): void {
    const error = new Error(text);
    if (requestId !== undefined) {
      take(this.analyses, requestId)?.reject(error);
      return;
    }
    if (sessionId === undefined) {
      log.warn('audio worker error', { message: text });
      return;
    }
    const start = take(this.starts, sessionId);
    if (start) {
      if (this.capturingSessionId === sessionId) this.capturingSessionId = undefined;
      start.reject(error);
      return;
    }
    const stop = take(this.stops, sessionId);
    if (this.capturingSessionId === sessionId) {
      this.capturingSessionId = undefined;
    }
    if (stop) {
      stop.reject(error);
      return;
    }
    this.deps.onCaptureError(sessionId, text);
  }

  private handleExit(process: WorkerProcess<P>, code: number): void {
    if (this.process !== process) {
      return;
    }
    this.process = undefined;
    log.warn('audio worker exited', { code });
    const error = new Error(`Audio worker stopped unexpectedly (exit code ${String(code)})`);
    const sessionId = this.capturingSessionId;
    this.capturingSessionId = undefined;
    for (const pending of [
      ...this.starts.values(),
      ...this.stops.values(),
      ...this.analyses.values(),
    ]) {
      pending.reject(error);
    }
    const wasStopping = sessionId !== undefined && this.stops.has(sessionId);
    this.starts.clear();
    this.stops.clear();
    this.analyses.clear();
    if (sessionId !== undefined && !wasStopping) {
      this.deps.onCaptureError(sessionId, error.message);
    }
  }
}

function take<T>(map: Map<string, T>, key: string): T | undefined {
  const value = map.get(key);
  map.delete(key);
  return value;
}

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(onTimeout());
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
