/** What to capture. Whole-system is the default; per-app needs the native helper (ARCHITECTURE.md §5.4). */
export type CaptureTarget =
  | { readonly kind: 'system' }
  | { readonly kind: 'process'; readonly pid: number; readonly name: string };

/**
 * A producer of 16 kHz mono 16-bit PCM frames of about 100 ms (ARCHITECTURE.md §5.1).
 * Everything downstream depends only on this contract.
 */
export interface AudioSource {
  readonly id: string;
  listTargets(): Promise<CaptureTarget[]>;
  start(target: CaptureTarget, onFrame: (pcm: Int16Array, tsMs: number) => void): Promise<void>;
  stop(): Promise<void>;
  on(event: 'error' | 'ended', cb: (e?: Error) => void): void;
}
