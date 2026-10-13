// Runs on the audio thread. Downmixes to mono, converts float32 to int16, and posts
// 100 ms frames (1600 samples at 16 kHz) to the page (ARCHITECTURE.md §5.2, Phase 0 spike).

const FRAME_SAMPLES = 1600;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  private frame = new Int16Array(FRAME_SAMPLES);
  private length = 0;

  process(inputs: Float32Array[][]): boolean {
    const channels = inputs[0];
    const first = channels?.[0];
    if (!channels || !first) {
      return true;
    }
    for (let i = 0; i < first.length; i++) {
      let sum = 0;
      for (const channel of channels) {
        sum += channel[i] ?? 0;
      }
      const s = Math.max(-1, Math.min(1, sum / channels.length));
      this.frame[this.length++] = s < 0 ? s * 0x8000 : s * 0x7fff;

      if (this.length === FRAME_SAMPLES) {
        this.port.postMessage(this.frame, [this.frame.buffer]);
        this.frame = new Int16Array(FRAME_SAMPLES);
        this.length = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-capture', PcmCaptureProcessor);
