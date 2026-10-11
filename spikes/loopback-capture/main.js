// Phase 0 spike (throwaway): Electron loopback capture -> 16 kHz mono 16-bit WAV.
// See docs/ARCHITECTURE.md §5.2 and §25. Verified against Electron 44.7.0 typings.
//
// Shortcut vs. the real design: PCM is returned to main in one piece at the end via
// executeJavaScript. The real app streams frames Capture Host -> Audio Worker over a MessagePort.

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, desktopCapturer, session } = require('electron');

const SAMPLE_RATE = 16000;
const CAPTURE_SECONDS = Number(process.env.CAPTURE_SECONDS ?? 60);
const KEEP_VIDEO = process.env.KEEP_VIDEO === '1';
const SHOW_WINDOW = process.env.SHOW_WINDOW === '1';
const AUDIO_MODE = process.env.AUDIO_MODE === 'loopbackWithMute' ? 'loopbackWithMute' : 'loopback';
const OUT_DIR = path.join(__dirname, 'out');

// The Capture Host is hidden and nobody clicks it, so the AudioContext must not wait for a gesture.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function encodeWav(pcmBytes, sampleRate) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmBytes.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(pcmBytes.length, 40);
  return Buffer.concat([header, pcmBytes]);
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
}

function fail(message) {
  console.error(`\nFAILED: ${message}`);
  app.exit(1);
}

function registerDisplayMediaHandler() {
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    console.log(
      `display-media request: origin=${request.securityOrigin} userGesture=${request.userGesture} ` +
        `video=${request.videoRequested} audio=${request.audioRequested}`,
    );
    desktopCapturer
      .getSources({ types: ['screen'] })
      .then((sources) => {
        const screen = sources[0];
        if (!screen) {
          callback(null);
          return;
        }
        console.log(`granting screen "${screen.name}" with audio=${AUDIO_MODE}`);
        callback({ video: screen, audio: AUDIO_MODE });
      })
      .catch((err) => {
        console.error('desktopCapturer.getSources failed', err);
        callback(null);
      });
  });
}

function printReport(result, filePath) {
  const { stats, events } = result;
  console.log('\n--- capture report ---');
  for (const line of events) console.log(`  ${line}`);
  console.log(`  file:              ${filePath}`);
  console.log(`  setup time:        ${stats.setupSec.toFixed(2)} s (getDisplayMedia -> audio flowing)`);
  console.log(`  wall clock:        ${stats.wallClockSec.toFixed(2)} s (since audio started)`);
  console.log(`  audio captured:    ${stats.audioSec.toFixed(2)} s (${stats.samples} samples)`);
  console.log(`  coverage:          ${(stats.coverage * 100).toFixed(1)}% of wall clock`);
  console.log(`  peak:              ${stats.peakDbfs.toFixed(1)} dBFS`);
  console.log(`  rms:               ${stats.rmsDbfs.toFixed(1)} dBFS`);
  console.log(`  clipped samples:   ${stats.clipped}`);
  console.log(`  non-silent frames: ${(stats.activeRatio * 100).toFixed(1)}% (100 ms frames above -50 dBFS)`);
  if (stats.activeRatio < 0.05) {
    console.log('\n  WARNING: almost no signal. Was audio playing? Is the right output device default?');
  }
}

async function run() {
  registerDisplayMediaHandler();

  const win = new BrowserWindow({
    show: SHOW_WINDOW,
    width: 480,
    height: 240,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // A hidden window is throttled by default; capture must keep running.
      backgroundThrottling: false,
    },
  });
  win.webContents.on('render-process-gone', (_e, details) => fail(`renderer gone: ${details.reason}`));

  await win.loadFile(path.join(__dirname, 'capture.html'), {
    query: { keepVideo: KEEP_VIDEO ? '1' : '0' },
  });

  // userGesture=true: getDisplayMedia normally requires transient user activation.
  const started = await win.webContents.executeJavaScript('startCapture()', true);
  console.log(`capture started: ${started}`);
  console.log(`recording ${CAPTURE_SECONDS} s of system audio... play something now.`);

  await new Promise((resolve) => setTimeout(resolve, CAPTURE_SECONDS * 1000));

  const result = await win.webContents.executeJavaScript('stopCapture()');
  const pcm = Buffer.from(result.pcm.buffer, result.pcm.byteOffset, result.pcm.byteLength);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const filePath = path.join(OUT_DIR, `capture-${timestamp()}.wav`);
  fs.writeFileSync(filePath, encodeWav(pcm, SAMPLE_RATE));

  printReport(result, filePath);
  app.quit();
}

app.whenReady().then(run).catch((err) => fail(err && err.stack ? err.stack : String(err)));
