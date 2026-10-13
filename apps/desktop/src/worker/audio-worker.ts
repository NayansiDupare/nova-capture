import { frameLevelDbfs, SILENT_LEVEL_DBFS } from '@nova/core';
import type { WorkerToMain } from '@nova/core';

import { analyzeSpool } from './spool-analyzer';
import type { SpoolAnalysis } from './spool-analyzer';
import { SpoolWriter } from './spool-writer';

/** A crash loses at most this much audio (PRD.md §7: "at most a few seconds"). */
export const DEFAULT_FLUSH_INTERVAL_MS = 1000;
/** Level updates for the meter: one per 3 frames (~300 ms) is plenty for a UI. */
const FRAMES_PER_LEVEL = 3;
/** Larger frames than this are not from our worklet (100 ms = 1600 samples). */
const MAX_FRAME_SAMPLES = 16_000;

export type AudioWorkerDeps = {
  readonly send: (message: WorkerToMain) => void;
  readonly openSpool?: (path: string) => SpoolWriter;
  readonly analyze?: (path: string) => Promise<SpoolAnalysis>;
  readonly flushIntervalMs?: number;
};

type ActiveCapture = {
  readonly sessionId: string;
  readonly spool: SpoolWriter;
  readonly flushTimer: ReturnType<typeof setInterval>;
  isPaused: boolean;
  levelMax: number;
  framesSinceLevel: number;
};

/**
 * The Audio Worker's logic, independent of the utility process plumbing (ARCHITECTURE.md §6):
 * spools frames during capture, reports levels, and analyzes finished spools.
 *
 * Any spool error ends the capture with an `error` message carrying the session id; main turns
 * that into `captureLost`, and the audio written so far is kept.
 */
export class AudioWorker {
  private capture: ActiveCapture | undefined;
  private readonly openSpool: (path: string) => SpoolWriter;
  private readonly analyzeSpoolFile: (path: string) => Promise<SpoolAnalysis>;

  constructor(private readonly deps: AudioWorkerDeps) {
    this.openSpool = deps.openSpool ?? ((path) => new SpoolWriter(path));
    this.analyzeSpoolFile = deps.analyze ?? analyzeSpool;
  }

  get activeSessionId(): string | undefined {
    return this.capture?.sessionId;
  }

  start(sessionId: string, spoolPath: string): void {
    if (this.capture) {
      this.deps.send({
        type: 'error',
        sessionId,
        message: `Already capturing session ${this.capture.sessionId}`,
      });
      return;
    }
    let spool: SpoolWriter;
    try {
      spool = this.openSpool(spoolPath);
    } catch (error) {
      this.deps.send({
        type: 'error',
        sessionId,
        message: `Cannot open spool: ${describe(error)}`,
      });
      return;
    }
    const flushTimer = setInterval(() => {
      this.flush();
    }, this.deps.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS);
    this.capture = {
      sessionId,
      spool,
      flushTimer,
      isPaused: false,
      levelMax: Number.NEGATIVE_INFINITY,
      framesSinceLevel: 0,
    };
    this.deps.send({ type: 'started', sessionId });
  }

  /** Handles one message from the Capture Host's frame port. Ignored unless capturing. */
  frame(data: unknown): void {
    const capture = this.capture;
    if (!capture || capture.isPaused || !isFrame(data)) {
      return;
    }
    capture.spool.append(data);

    capture.levelMax = Math.max(capture.levelMax, frameLevelDbfs(data));
    capture.framesSinceLevel++;
    if (capture.framesSinceLevel >= FRAMES_PER_LEVEL) {
      this.deps.send({
        type: 'level',
        sessionId: capture.sessionId,
        dbfs: Math.max(SILENT_LEVEL_DBFS, capture.levelMax),
      });
      capture.levelMax = Number.NEGATIVE_INFINITY;
      capture.framesSinceLevel = 0;
    }
  }

  pause(): void {
    if (this.capture) {
      this.capture.isPaused = true;
      this.flush();
    }
  }

  resume(): void {
    if (this.capture) {
      this.capture.isPaused = false;
    }
  }

  /** Flushes and closes the spool, then reports `stopped`. A no-op when not capturing. */
  stop(): void {
    const capture = this.capture;
    if (!capture) {
      return;
    }
    this.capture = undefined;
    clearInterval(capture.flushTimer);
    try {
      capture.spool.close();
    } catch (error) {
      this.deps.send({
        type: 'error',
        sessionId: capture.sessionId,
        message: `Spool write failed: ${describe(error)}`,
      });
      return;
    }
    this.deps.send({
      type: 'stopped',
      sessionId: capture.sessionId,
      bytesWritten: capture.spool.bytesWritten,
      droppedFrames: capture.spool.droppedFrames,
    });
  }

  /** Analyzes a finished spool. Replies `analyzed`, or `error` with the request id. */
  async analyze(requestId: string, spoolPath: string): Promise<void> {
    try {
      const analysis = await this.analyzeSpoolFile(spoolPath);
      this.deps.send({ type: 'analyzed', requestId, ...analysis });
    } catch (error) {
      this.deps.send({
        type: 'error',
        requestId,
        message: `Cannot analyze spool: ${describe(error)}`,
      });
    }
  }

  private flush(): void {
    const capture = this.capture;
    if (!capture) {
      return;
    }
    try {
      capture.spool.flush();
    } catch (error) {
      this.fail(capture, error);
    }
  }

  private fail(capture: ActiveCapture, error: unknown): void {
    this.capture = undefined;
    clearInterval(capture.flushTimer);
    try {
      capture.spool.close();
    } catch {
      // Already failing: the original error below is the one to report.
    }
    this.deps.send({
      type: 'error',
      sessionId: capture.sessionId,
      message: `Spool write failed: ${describe(error)}`,
    });
  }
}

function isFrame(data: unknown): data is Int16Array {
  return data instanceof Int16Array && data.length > 0 && data.length <= MAX_FRAME_SAMPLES;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
