import type { AudioSource, CaptureTarget } from '../audio/audio-source';
import { FRAME_MS } from '../audio/vad';
import { samplesForDurationMs } from '../audio-format';

const FRAME_SAMPLES = samplesForDurationMs(FRAME_MS);

/**
 * Test double for {@link AudioSource} that replays `pcm` as 100 ms frames.
 *
 * With `manual: true`, `start` delivers nothing and the test calls {@link FakeAudioSource.emit};
 * otherwise every frame is delivered during `start`. {@link FakeAudioSource.end} and
 * {@link FakeAudioSource.fail} simulate the device going away.
 */
export class FakeAudioSource implements AudioSource {
  readonly id = 'fake';
  private onFrame: ((pcm: Int16Array, tsMs: number) => void) | undefined;
  private next = 0;
  private readonly listeners = {
    error: [] as ((e?: Error) => void)[],
    ended: [] as ((e?: Error) => void)[],
  };

  constructor(
    private readonly pcm: Int16Array,
    private readonly options: { manual?: boolean } = {},
  ) {}

  /** Number of frames not yet delivered. */
  get remainingFrames(): number {
    return Math.ceil((this.pcm.length - this.next * FRAME_SAMPLES) / FRAME_SAMPLES);
  }

  listTargets(): Promise<CaptureTarget[]> {
    return Promise.resolve([{ kind: 'system' }]);
  }

  start(_target: CaptureTarget, onFrame: (pcm: Int16Array, tsMs: number) => void): Promise<void> {
    this.onFrame = onFrame;
    if (!this.options.manual) {
      this.emit(this.remainingFrames);
    }
    return Promise.resolve();
  }

  stop(): Promise<void> {
    this.onFrame = undefined;
    return Promise.resolve();
  }

  on(event: 'error' | 'ended', cb: (e?: Error) => void): void {
    this.listeners[event].push(cb);
  }

  /** Delivers up to `frames` frames. The last frame may be shorter than 100 ms. */
  emit(frames: number): void {
    for (let i = 0; i < frames && this.remainingFrames > 0; i++) {
      const start = this.next * FRAME_SAMPLES;
      this.onFrame?.(this.pcm.slice(start, start + FRAME_SAMPLES), this.next * FRAME_MS);
      this.next++;
    }
  }

  end(): void {
    for (const cb of this.listeners.ended) cb();
  }

  fail(error: Error): void {
    for (const cb of this.listeners.error) cb(error);
  }
}
