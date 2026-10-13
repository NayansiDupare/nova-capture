import type { TranscriptSegment } from '@nova/core';

import type { IpcHandlers } from './ipc-router';
import type { SettingsRepo } from '../db/settings-repo';
import type { SecretStore } from '../secrets/secret-store';

/** The orchestrator operations the UI may trigger. */
export type CaptureControl = {
  start(): Promise<string>;
  stop(): Promise<void>;
  pause(): void;
  resume(): void;
  retry(sessionId: string): Promise<void>;
  discard(sessionId: string): Promise<void>;
  transcript(sessionId: string): TranscriptSegment[];
};

/** Wires each IPC channel to the main-process service that owns it. */
export function createIpcHandlers(deps: {
  settings: SettingsRepo;
  secrets: SecretStore;
  capture: CaptureControl;
}): IpcHandlers {
  const { capture } = deps;
  return {
    'settings:get': () => deps.settings.get(),
    'settings:set': (patch) => deps.settings.update(patch),
    'secrets:set': ({ id, apiKey }) => deps.secrets.set(id, apiKey),
    'capture:start': async () => ({ sessionId: await capture.start() }),
    'capture:stop': async () => {
      await capture.stop();
      return {};
    },
    'capture:pause': () => {
      capture.pause();
      return {};
    },
    'capture:resume': () => {
      capture.resume();
      return {};
    },
    'sessions:retry': async ({ sessionId }) => {
      await capture.retry(sessionId);
      return {};
    },
    'sessions:discard': async ({ sessionId }) => {
      await capture.discard(sessionId);
      return {};
    },
    'sessions:transcript': ({ sessionId }) => ({ segments: capture.transcript(sessionId) }),
  };
}
