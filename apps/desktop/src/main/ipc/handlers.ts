import type { IpcHandlers } from './ipc-router';
import type { SettingsRepo } from '../db/settings-repo';
import type { SecretStore } from '../secrets/secret-store';

/** Wires each IPC channel to the main-process service that owns it. */
export function createIpcHandlers(deps: {
  settings: SettingsRepo;
  secrets: SecretStore;
}): IpcHandlers {
  return {
    'settings:get': () => deps.settings.get(),
    'settings:set': (patch) => deps.settings.update(patch),
    'secrets:set': ({ id, apiKey }) => deps.secrets.set(id, apiKey),
  };
}
