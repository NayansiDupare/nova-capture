import { assembleTranscript, planChunks } from '@nova/core';
import type { IpcEventPayload, SessionEvent, TranscriptSegment } from '@nova/core';

import type { SpoolAnalysisResult, SpoolStopResult } from '../capture/worker-host';
import type { Job, JobsRepo } from '../db/jobs-repo';
import type { SessionRecord, SessionsRepo } from '../db/sessions-repo';
import type { TranscriptChunksRepo } from '../db/transcript-chunks-repo';
import type { JobOutcome } from '../jobs/job-runner';
import { transcribeJobFor, transcriptionStatus } from '../jobs/transcribe-chunk';
import { log } from '../log';

export type WorkerControl<P> = {
  start(sessionId: string, spoolPath: string, framePort: P): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): Promise<SpoolStopResult>;
  analyze(spoolPath: string): Promise<SpoolAnalysisResult>;
};

export type CaptureHostControl<P> = {
  /** Starts loopback capture and sends frames to `framePort`. */
  start(framePort: P): Promise<void>;
  stop(): Promise<void>;
};

export type OrchestratorDeps<P> = {
  readonly sessions: SessionsRepo;
  readonly jobs: JobsRepo;
  readonly chunks: TranscriptChunksRepo;
  readonly worker: WorkerControl<P>;
  readonly captureHost: CaptureHostControl<P>;
  /** A connected pair: frames posted on `hostPort` arrive on `workerPort`. */
  readonly createFramePorts: () => { hostPort: P; workerPort: P };
  readonly spoolPathFor: (sessionId: string) => string;
  readonly newId: () => string;
  readonly now: () => number;
  readonly emit: (event: IpcEventPayload<'session:state'>) => void;
};

/** Shown on sessions recovered after the app closed mid-capture. */
export const CLOSED_DURING_CAPTURE =
  'Nova Capture closed during the capture. The audio so far was kept.';

/**
 * Drives capture sessions through the state machine (ARCHITECTURE.md §8). Every transition is
 * persisted before it is announced, and no step deletes a spool or transcript.
 */
export class SessionOrchestrator<P> {
  /** The session that owns the capture device (STARTING, LISTENING or PAUSED). */
  private capturingId: string | undefined;
  /** A loss reported while the session was still STARTING, applied once it is LISTENING. */
  private readonly lossDuringStart = new Map<string, string>();

  constructor(private readonly deps: OrchestratorDeps<P>) {}

  get activeSessionId(): string | undefined {
    return this.capturingId;
  }

  /** Starts a capture, or returns the one already running. */
  async start(): Promise<string> {
    if (this.capturingId !== undefined) {
      return this.capturingId;
    }
    const id = this.deps.newId();
    const spoolPath = this.deps.spoolPathFor(id);
    const created = this.deps.sessions.create({
      id,
      startedAt: this.deps.now(),
      captureSource: 'electron-loopback',
      spoolPath,
    });
    this.announce(created);
    this.capturingId = id;

    const { hostPort, workerPort } = this.deps.createFramePorts();
    try {
      await this.deps.worker.start(id, spoolPath, workerPort);
      await this.deps.captureHost.start(hostPort);
    } catch (error) {
      await this.teardownCapture();
      if (this.capturingId === id) {
        this.capturingId = undefined;
        this.apply(id, { type: 'startFailed', error: describe(error) });
      }
      return id;
    }
    if (this.capturingId !== id) {
      // Stopped or discarded while starting.
      this.lossDuringStart.delete(id);
      await this.teardownCapture();
      return id;
    }
    this.apply(id, { type: 'started' });
    const lost = this.lossDuringStart.get(id);
    if (lost !== undefined) {
      // Frames may already be on disk, so this is a stop, not a failed start.
      this.lossDuringStart.delete(id);
      await this.captureLost(id, lost);
    }
    return id;
  }

  pause(): void {
    const id = this.capturingId;
    if (id !== undefined && this.deps.sessions.get(id)?.state === 'LISTENING') {
      this.deps.worker.pause();
      this.apply(id, { type: 'pause' });
    }
  }

  resume(): void {
    const id = this.capturingId;
    if (id !== undefined && this.deps.sessions.get(id)?.state === 'PAUSED') {
      this.deps.worker.resume();
      this.apply(id, { type: 'resume' });
    }
  }

  /** Stops the running capture and starts transcription. Does nothing without a capture. */
  async stop(): Promise<void> {
    const id = this.capturingId;
    if (id === undefined) {
      return;
    }
    this.capturingId = undefined;
    const state = this.deps.sessions.get(id)?.state;
    if (state === 'STARTING') {
      this.apply(id, { type: 'cancel' });
      return;
    }
    this.apply(id, { type: 'stop' });
    await this.deps.captureHost.stop().catch(logError('capture host stop failed', id));
    await this.finishCapture(id);
  }

  /**
   * The device or worker failed mid-capture: keep the audio so far and transcribe it.
   * Called from event callbacks, so it logs failures instead of rejecting.
   */
  async captureLost(sessionId: string, reason: string): Promise<void> {
    if (this.capturingId !== sessionId) {
      return;
    }
    try {
      if (this.deps.sessions.get(sessionId)?.state === 'STARTING') {
        this.lossDuringStart.set(sessionId, reason);
        return;
      }
      this.capturingId = undefined;
      this.apply(sessionId, { type: 'captureLost', error: reason });
      await this.deps.captureHost.stop().catch(logError('capture host stop failed', sessionId));
      await this.finishCapture(sessionId);
    } catch (error) {
      log.error('handling capture loss failed', { sessionId, error: describe(error) });
    }
  }

  /** Called by the job runner after each attempt. Logs failures instead of throwing. */
  onJobSettled(job: Job, outcome: JobOutcome): void {
    if (job.type !== 'transcribe_chunk' || outcome === 'retrying') {
      return;
    }
    try {
      this.checkTranscription(job.sessionId);
    } catch (error) {
      log.error('checking transcription failed', {
        sessionId: job.sessionId,
        error: describe(error),
      });
    }
  }

  /** Retries a failed transcription: re-plans if planning failed, otherwise re-runs failed jobs. */
  async retry(sessionId: string): Promise<void> {
    this.apply(sessionId, { type: 'retry' });
    if (this.deps.jobs.listBySession(sessionId).length === 0) {
      await this.planTranscription(sessionId);
    } else {
      this.deps.jobs.retryFailed(sessionId, this.deps.now());
    }
  }

  /** Discards a session. Its queued jobs are dropped so no more money is spent on it. */
  async discard(sessionId: string): Promise<void> {
    if (this.capturingId === sessionId) {
      this.capturingId = undefined;
      await this.teardownCapture();
    }
    const isStarting = this.deps.sessions.get(sessionId)?.state === 'STARTING';
    this.apply(sessionId, { type: isStarting ? 'cancel' : 'discard' });
    this.deps.jobs.cancelSession(sessionId);
  }

  /** The transcript assembled from the chunks finished so far. */
  transcript(sessionId: string): TranscriptSegment[] {
    return assembleTranscript(this.deps.chunks.listBySession(sessionId));
  }

  /**
   * At launch: finish what a crash interrupted (ARCHITECTURE.md §8). Captures cut off mid-way
   * are stopped and transcribed with the audio that reached the spool.
   */
  async recover(): Promise<void> {
    this.deps.jobs.requeueInterrupted(this.deps.now());
    for (const session of this.deps.sessions.listUnfinished()) {
      try {
        await this.recoverSession(session);
      } catch (error) {
        log.error('session recovery failed', { sessionId: session.id, error: describe(error) });
      }
    }
  }

  private async recoverSession(session: SessionRecord): Promise<void> {
    switch (session.state) {
      case 'STARTING':
        this.apply(session.id, { type: 'cancel' });
        return;
      case 'LISTENING':
      case 'PAUSED':
        this.apply(session.id, { type: 'captureLost', error: CLOSED_DURING_CAPTURE });
        await this.finishCapture(session.id);
        return;
      case 'STOPPING':
        await this.finishCapture(session.id);
        return;
      case 'TRANSCRIBING':
        if (session.error !== null) {
          return; // Waiting for the user to retry.
        }
        if (this.deps.jobs.listBySession(session.id).length === 0) {
          await this.planTranscription(session.id);
        } else {
          this.checkTranscription(session.id);
        }
        return;
      default:
        // GENERATING and REVIEW are picked up by the note pipeline (Phase 3).
        return;
    }
  }

  /** STOPPING → TRANSCRIBING: close the spool, then plan and queue the chunk jobs. */
  private async finishCapture(sessionId: string): Promise<void> {
    await this.deps.worker.stop().catch(logError('worker stop failed', sessionId));
    this.apply(sessionId, { type: 'stopped' });
    await this.planTranscription(sessionId);
  }

  private async planTranscription(sessionId: string): Promise<void> {
    const spoolPath = this.deps.sessions.get(sessionId)?.spoolPath;
    try {
      if (!spoolPath) {
        throw new Error('This session has no audio file');
      }
      const analysis = await this.deps.worker.analyze(spoolPath);
      this.deps.sessions.recordAnalysis(sessionId, analysis);
      const plan = planChunks(analysis.durationMs, analysis.speech);
      this.deps.jobs.enqueue(
        plan.map((chunk) => transcribeJobFor(sessionId, chunk)),
        this.deps.now(),
      );
    } catch (error) {
      this.apply(sessionId, {
        type: 'transcribeFailed',
        error: `Could not read the audio: ${describe(error)}`,
      });
      return;
    }
    // No speech means no jobs: transcription is already complete.
    this.checkTranscription(sessionId);
  }

  private checkTranscription(sessionId: string): void {
    const session = this.deps.sessions.get(sessionId);
    if (session?.state !== 'TRANSCRIBING' || session.error !== null) {
      return;
    }
    const jobs = this.deps.jobs.listBySession(sessionId);
    const status = transcriptionStatus(jobs);
    if (status === 'done') {
      this.apply(sessionId, { type: 'transcribed' });
    } else if (status === 'failed') {
      const lastError =
        jobs.find((job) => job.status === 'failed')?.lastError ?? 'Transcription failed';
      this.apply(sessionId, { type: 'transcribeFailed', error: lastError });
    }
  }

  private async teardownCapture(): Promise<void> {
    await this.deps.captureHost.stop().catch(logError('capture host stop failed'));
    await this.deps.worker.stop().catch(logError('worker stop failed'));
  }

  private apply(sessionId: string, event: SessionEvent): void {
    this.announce(this.deps.sessions.transition(sessionId, event));
  }

  private announce(session: SessionRecord): void {
    this.deps.emit({ sessionId: session.id, state: session.state, error: session.error });
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function logError(message: string, sessionId?: string) {
  return (error: unknown) => {
    log.warn(message, { sessionId, error: describe(error) });
  };
}
