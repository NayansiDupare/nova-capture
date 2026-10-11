# Spike: Electron loopback capture

Throwaway Phase 0 prototype (ARCHITECTURE.md §5.2, §25). A hidden Electron window captures
system playback audio with `getDisplayMedia` + loopback, converts it to 16 kHz mono 16-bit PCM
in an AudioWorklet, and saves a WAV file to `out/`. Nothing here is imported by the real app.

Verified on **Electron 44.7.0**, Windows 11.

## Run

```powershell
cd spikes/loopback-capture
pnpm install
# Electron downloads its binary on first launch. To fetch it ahead of time:
node node_modules/electron/install.js

pnpm start                         # records 60 s
```

Options (PowerShell: set with `$env:NAME = 'value'` before `pnpm start`):

| Variable | Default | Effect |
|---|---|---|
| `CAPTURE_SECONDS` | `60` | Recording length |
| `AUDIO_MODE` | `loopback` | `loopbackWithMute` mutes your speakers while capturing |
| `KEEP_VIDEO` | `0` | `1` keeps the (unused) video track alive instead of stopping it |
| `SHOW_WINDOW` | `0` | `1` shows the capture host window for debugging |

`pnpm start` goes through `launch.js`, which removes `ELECTRON_RUN_AS_NODE`. VS Code terminals
set it, and without the launcher Electron runs as plain Node.

## Output

The console prints a report after each run: setup time, captured seconds vs. wall clock
(coverage), peak/RMS level, clipped samples and the share of non-silent 100 ms frames.
A near-zero non-silent share prints a warning.

## Known shortcuts (spike only)

- PCM is sent to main in one piece at the end. The real app streams frames to the Audio Worker
  over a MessagePort and spools to disk.
- No CSP, permission handler or preload. Electron hardening comes in Phase 1 (SECURITY.md).
- The trailing partial frame (< 100 ms) is dropped.
