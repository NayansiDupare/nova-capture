/** Shared between the Capture Host preload and its page. */

/** The `window.postMessage` type that carries the frame MessagePort into the page. */
export const FRAME_PORT_MESSAGE = 'nova:frame-port';

/** Exposed by the preload as `window.novaCaptureHostBridge`. */
export type CaptureHostBridge = {
  /** Tells main the audio stopped on its own (device change, track ended). */
  reportEnded(reason: string): void;
};

/** Defined by the page as `window.novaCaptureHost`; main calls it via `executeJavaScript`. */
export type CaptureHostApi = {
  start(): Promise<string>;
  stop(): Promise<void>;
};
