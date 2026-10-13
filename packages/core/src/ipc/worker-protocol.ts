import { z } from 'zod';

/**
 * Messages between main and the Audio Worker (utility process). Not renderer IPC, but validated
 * the same way: each side parses what it receives. Audio frames never use this channel; they
 * arrive on a dedicated MessagePort from the Capture Host (AGENTS.md §4.8).
 */

/** Level reported for digital silence, since -Infinity is not a valid message number. */
export const SILENT_LEVEL_DBFS = -100;

const SpeechSpanSchema = z.object({ startMs: z.number(), endMs: z.number() });

export const MainToWorkerSchema = z.discriminatedUnion('type', [
  /** Sent with the frame MessagePort as the first transferred port. */
  z.object({
    type: z.literal('start'),
    sessionId: z.string().min(1),
    spoolPath: z.string().min(1),
  }),
  z.object({ type: z.literal('pause') }),
  z.object({ type: z.literal('resume') }),
  z.object({ type: z.literal('stop') }),
  z.object({
    type: z.literal('analyze'),
    requestId: z.string().min(1),
    spoolPath: z.string().min(1),
  }),
]);
export type MainToWorker = z.infer<typeof MainToWorkerSchema>;

export const WorkerToMainSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('started'), sessionId: z.string() }),
  z.object({ type: z.literal('level'), sessionId: z.string(), dbfs: z.number() }),
  z.object({
    type: z.literal('stopped'),
    sessionId: z.string(),
    bytesWritten: z.number().int().nonnegative(),
    droppedFrames: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('analyzed'),
    requestId: z.string(),
    durationMs: z.number().nonnegative(),
    speech: z.array(SpeechSpanSchema),
    speechRatio: z.number().min(0).max(1),
  }),
  /** `sessionId` is set when the error ends a capture; `requestId` when it fails an analysis. */
  z.object({
    type: z.literal('error'),
    message: z.string(),
    sessionId: z.string().optional(),
    requestId: z.string().optional(),
  }),
]);
export type WorkerToMain = z.infer<typeof WorkerToMainSchema>;
