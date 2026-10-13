import { contextBridge, ipcRenderer } from 'electron';

import type { CAPTURE_HOST_CHANNELS } from '@nova/core';

import { FRAME_PORT_MESSAGE } from './capture-host-api';
import type { CaptureHostBridge } from './capture-host-api';

// Literal channel names (type-checked against core) keep zod out of this sandboxed preload.
const PORT_CHANNEL: (typeof CAPTURE_HOST_CHANNELS)['port'] = 'capture-host:port';
const ENDED_CHANNEL: (typeof CAPTURE_HOST_CHANNELS)['ended'] = 'capture-host:ended';

/** The DOM's `window.postMessage`; preloads are type-checked without the DOM lib. */
type PostMessageTarget = {
  postMessage(message: unknown, targetOrigin: string, transfer: unknown[]): void;
};

// The port can only reach the page's (isolated) world through window.postMessage.
ipcRenderer.on(PORT_CHANNEL, (event) => {
  // MessagePort is a DOM type, which preloads are checked without.
  const ports: readonly unknown[] = event.ports;
  const port = ports[0];
  if (port) {
    (globalThis as unknown as PostMessageTarget).postMessage({ type: FRAME_PORT_MESSAGE }, '*', [
      port,
    ]);
  }
});

const bridge: CaptureHostBridge = {
  reportEnded: (reason) => {
    ipcRenderer.send(ENDED_CHANNEL, { reason: reason.slice(0, 500) });
  },
};

contextBridge.exposeInMainWorld('novaCaptureHostBridge', bridge);
