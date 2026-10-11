import { contextBridge } from 'electron';

import type { NovaApi } from './api';

const api: NovaApi = {};

contextBridge.exposeInMainWorld('nova', api);
