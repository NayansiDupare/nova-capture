import { z } from 'zod';

/**
 * Channels between main and the hidden Capture Host window only (ARCHITECTURE.md §5.2).
 * The audio itself never uses these: it flows over the transferred MessagePort to the worker.
 */
export const CAPTURE_HOST_CHANNELS = {
  /** main → host: carries the MessagePort for frames as its only transferred port. */
  port: 'capture-host:port',
  /** host → main: the audio track ended or the graph failed mid-capture. */
  ended: 'capture-host:ended',
} as const;

export const CaptureHostEndedSchema = z.strictObject({
  reason: z.string().min(1).max(500),
});
export type CaptureHostEnded = z.infer<typeof CaptureHostEndedSchema>;
