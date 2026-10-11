// Capture Host (spike): getDisplayMedia loopback -> AudioContext @ 16 kHz -> AudioWorklet -> Int16 frames.
// startCapture() and stopCapture() are called from main via webContents.executeJavaScript.

const SAMPLE_RATE = 16000;
const FRAME_SAMPLES = 1600; // 100 ms, must match pcm-worklet.js
const SILENCE_DBFS = -50;
const KEEP_VIDEO = new URLSearchParams(location.search).get('keepVideo') === '1';

const frames = [];
const events = [];
let stream = null;
let ctx = null;
let startedAt = 0;
let audioStartedAt = 0;
let setupSec = 0;

function note(message) {
  const sec = ((performance.now() - startedAt) / 1000).toFixed(1);
  events.push(`[${sec}s] ${message}`);
}

async function startCapture() {
  startedAt = performance.now();
  // Video is required by getDisplayMedia; we drop it right away unless KEEP_VIDEO=1.
  // Chrome enables voice processing on the loopback track by default; it damages playback audio.
  stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });

  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    throw new Error('getDisplayMedia returned no audio track (loopback not granted)');
  }
  for (const track of stream.getTracks()) {
    track.addEventListener('ended', () => note(`${track.kind} track ended`));
  }
  if (!KEEP_VIDEO) {
    for (const track of stream.getVideoTracks()) track.stop();
    note('video track stopped');
  }

  ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  await ctx.audioWorklet.addModule('pcm-worklet.js');
  const source = ctx.createMediaStreamSource(new MediaStream(audioTracks));
  const node = new AudioWorkletNode(ctx, 'pcm-capture');
  node.port.onmessage = (event) => frames.push(event.data);
  source.connect(node);
  // The worklet writes no output (silence); connecting keeps the graph pulling it.
  node.connect(ctx.destination);

  setupSec = (performance.now() - startedAt) / 1000;
  audioStartedAt = performance.now();
  const settings = audioTracks[0].getSettings();
  note(
    `audio track "${audioTracks[0].label}" settings=${JSON.stringify(settings)} ` +
      `context=${ctx.sampleRate} Hz state=${ctx.state}`,
  );
  return `context ${ctx.sampleRate} Hz, ${ctx.state}`;
}

function toDbfs(value) {
  return value > 0 ? 20 * Math.log10(value) : -Infinity;
}

function computeStats(pcm, frameCount) {
  let peak = 0;
  let sumSquares = 0;
  let clipped = 0;
  for (let i = 0; i < pcm.length; i++) {
    const s = pcm[i] / 32768;
    const abs = Math.abs(s);
    if (abs > peak) peak = abs;
    if (abs >= 0.999) clipped++;
    sumSquares += s * s;
  }
  let activeFrames = 0;
  for (let f = 0; f < frameCount; f++) {
    let frameSquares = 0;
    for (let i = f * FRAME_SAMPLES; i < (f + 1) * FRAME_SAMPLES; i++) {
      const s = pcm[i] / 32768;
      frameSquares += s * s;
    }
    if (toDbfs(Math.sqrt(frameSquares / FRAME_SAMPLES)) > SILENCE_DBFS) activeFrames++;
  }
  const wallClockSec = (performance.now() - audioStartedAt) / 1000;
  const audioSec = pcm.length / SAMPLE_RATE;
  return {
    setupSec,
    samples: pcm.length,
    audioSec,
    wallClockSec,
    coverage: audioSec / wallClockSec,
    peakDbfs: toDbfs(peak),
    rmsDbfs: toDbfs(Math.sqrt(sumSquares / Math.max(1, pcm.length))),
    clipped,
    activeRatio: frameCount > 0 ? activeFrames / frameCount : 0,
  };
}

async function stopCapture() {
  const audioState = stream?.getAudioTracks()[0]?.readyState ?? 'none';
  note(`stopping (audio track readyState=${audioState})`);
  if (stream) for (const track of stream.getTracks()) track.stop();
  if (ctx) await ctx.close();

  // The trailing partial frame (<100 ms) is dropped; fine for a spike.
  const pcm = new Int16Array(frames.length * FRAME_SAMPLES);
  frames.forEach((frame, i) => pcm.set(frame, i * FRAME_SAMPLES));

  return {
    pcm: new Uint8Array(pcm.buffer),
    stats: computeStats(pcm, frames.length),
    events,
  };
}
