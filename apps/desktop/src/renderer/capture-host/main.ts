// Capture Host page: getDisplayMedia loopback → AudioContext @ 16 kHz → AudioWorklet → frames
// to the Audio Worker over a MessagePort (ARCHITECTURE.md §5.2). No framework, no UI.
import workletUrl from './pcm-worklet.ts?worker&url';
import { FRAME_PORT_MESSAGE } from '../../preload/capture-host-api';

const SAMPLE_RATE = 16_000;
const PORT_WAIT_MS = 5_000;

let framePort: MessagePort | undefined;
let stream: MediaStream | undefined;
let context: AudioContext | undefined;
let isStopping = false;
const portWaiters: ((port: MessagePort) => void)[] = [];

window.addEventListener('message', (event) => {
  const data: unknown = event.data;
  const port = event.ports[0];
  if (
    event.source === window &&
    port &&
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === FRAME_PORT_MESSAGE
  ) {
    framePort?.close();
    framePort = port;
    for (const resolve of portWaiters.splice(0)) resolve(port);
  }
});

function waitForPort(): Promise<MessagePort> {
  if (framePort) {
    return Promise.resolve(framePort);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('No frame port from main'));
    }, PORT_WAIT_MS);
    portWaiters.push((port) => {
      clearTimeout(timer);
      resolve(port);
    });
  });
}

function reportEnded(reason: string): void {
  if (!isStopping) {
    window.novaCaptureHostBridge.reportEnded(reason);
  }
}

async function start(): Promise<string> {
  // Release any previous capture's audio, but keep the port main just sent for this one.
  await stopAudio();
  isStopping = false;
  const port = await waitForPort();

  // Chrome turns on voice processing by default, even for loopback; it damages playback audio.
  stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    await stop();
    throw new Error('System audio was not shared (no loopback audio track)');
  }
  // getDisplayMedia requires video; we never use it.
  for (const track of stream.getVideoTracks()) track.stop();
  for (const track of audioTracks) {
    track.addEventListener('ended', () => {
      reportEnded('The system audio stream ended');
    });
  }

  const ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
  context = ctx;
  await ctx.audioWorklet.addModule(workletUrl);
  const source = ctx.createMediaStreamSource(new MediaStream(audioTracks));
  const node = new AudioWorkletNode(ctx, 'pcm-capture');
  node.port.onmessage = (event: MessageEvent<Int16Array>) => {
    // Copied, not transferred: Electron's MessagePortMain (the worker's end) only accepts
    // transferred ports, and a transferred ArrayBuffer arrives as null. 3.2 KB per 100 ms.
    port.postMessage(event.data);
  };
  source.connect(node);
  // The worklet outputs silence; connecting it keeps the graph pulling audio.
  node.connect(ctx.destination);
  ctx.addEventListener('statechange', () => {
    // Only this capture's own context: an older one closing must not end a newer capture.
    if (ctx === context && ctx.state === 'closed') reportEnded('The audio graph closed');
  });
  return `${String(ctx.sampleRate)} Hz, ${ctx.state}`;
}

/** Ends the capture and releases its frame port. */
async function stop(): Promise<void> {
  await stopAudio();
  // Each capture gets a fresh port; the worker's end is closed by main.
  framePort?.close();
  framePort = undefined;
}

async function stopAudio(): Promise<void> {
  isStopping = true;
  for (const track of stream?.getTracks() ?? []) track.stop();
  stream = undefined;
  const closing = context;
  context = undefined;
  if (closing && closing.state !== 'closed') {
    await closing.close();
  }
}

window.novaCaptureHost = { start, stop };
