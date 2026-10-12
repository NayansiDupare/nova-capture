import { contextBridge, ipcRenderer } from 'electron';

import type { NovaApi } from './api';

// Never expose ipcRenderer itself (SECURITY.md §4). Channel names are literals so a renderer
// cannot pick one; payloads are validated in main.
const api: NovaApi = {
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
  },
  secrets: {
    set: (request) => ipcRenderer.invoke('secrets:set', request),
  },
};

contextBridge.exposeInMainWorld('nova', api);
