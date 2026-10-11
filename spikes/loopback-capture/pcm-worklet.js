// Runs on the audio thread. Downmixes to mono, converts float32 -> int16,
// and posts 100 ms frames (1600 samples at 16 kHz) to the Capture Host.

const FRAME_SAMPLES = 1600;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Int16Array(FRAME_SAMPLES);
    this.length = 0;
  }

  process(inputs) {
    const channels = inputs[0];
    if (!channels || channels.length === 0) return true;

    const blockSize = channels[0].length;
    for (let i = 0; i < blockSize; i++) {
      let sum = 0;
      for (let c = 0; c < channels.length; c++) sum += channels[c][i];
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
