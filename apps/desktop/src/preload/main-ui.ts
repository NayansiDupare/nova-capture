import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';

import type { IpcEvent } from '@nova/core';

import type { NovaApi } from './api';

// Never expose ipcRenderer itself (SECURITY.md §4). Channel names are literals so a renderer
// cannot pick one; payloads are validated in main.
const EVENTS: ReadonlySet<IpcEvent> = new Set<IpcEvent>(['session:state', 'capture:level']);

const api: NovaApi = {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
  },
  secrets: {
    set: (request) => ipcRenderer.invoke('secrets:set', request),
  },
  capture: {
    start: () => ipcRenderer.invoke('capture:start'),
    stop: () => ipcRenderer.invoke('capture:stop'),
    pause: () => ipcRenderer.invoke('capture:pause'),
    resume: () => ipcRenderer.invoke('capture:resume'),
  },
  sessions: {
    retry: (request) => ipcRenderer.invoke('sessions:retry', request),
    discard: (request) => ipcRenderer.invoke('sessions:discard', request),
    transcript: (request) => ipcRenderer.invoke('sessions:transcript', request),
  },
  on: (event, listener) => {
    if (!EVENTS.has(event)) {
      throw new Error(`Unknown event: ${event}`);
    }
    // The IPC event object is not passed on: it would give the page access to `sender`.
    // Main validated the payload against IPC_EVENTS before sending it.
    const handler = (_event: IpcRendererEvent, payload: unknown) => {
      listener(payload as Parameters<typeof listener>[0]);
    };
    ipcRenderer.on(event, handler);
    return () => {
      ipcRenderer.removeListener(event, handler);
    };
  },
};

contextBridge.exposeInMainWorld('nova', api);
