import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import {
  app,
  dialog,
  ipcMain,
  MessageChannelMain,
  safeStorage,
  session,
  utilityProcess,
} from 'electron';
import type { MessagePortMain } from 'electron';

import { CAPTURE_HOST_CHANNELS, CaptureHostEndedSchema, ProviderError } from '@nova/core';

import { CaptureHostWindow } from './capture/capture-host-window';
import { WorkerHost } from './capture/worker-host';
import { JobsRepo } from './db/jobs-repo';
import { openDatabase } from './db/open-database';
import { SessionsRepo } from './db/sessions-repo';
import { SettingsRepo } from './db/settings-repo';
import { TranscriptChunksRepo } from './db/transcript-chunks-repo';
import { UsageRepo } from './db/usage-repo';
import { createIpcHandlers } from './ipc/handlers';
import { registerIpcHandlers } from './ipc/ipc-router';
import { JobRunner } from './jobs/job-runner';
import { createTranscribeChunkHandler } from './jobs/transcribe-chunk';
import { log } from './log';
import { createSttProvider } from './providers/stt-registry';
import { SecretStore } from './secrets/secret-store';
import { SessionOrchestrator } from './session/orchestrator';
import { WindowManager } from './windows/window-manager';

// The Capture Host is hidden and never clicked, so its AudioContext must not wait for a gesture.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

/**
 * SECURITY.md §3.2: no navigation, no new windows, no webviews. Permissions are denied to
 * everything except the Capture Host (see CaptureHostWindow.install).
 */
function hardenContents(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event) => {
      event.preventDefault();
    });
    contents.on('will-attach-webview', (event) => {
      event.preventDefault();
    });
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
}

async function start(): Promise<void> {
  // One instance only: two processes recovering or capturing the same sessions would corrupt state.
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  // SECURITY.md §6: data lives in %APPDATA%/Nova Capture, independent of the package name.
  app.setPath('userData', join(app.getPath('appData'), 'Nova Capture'));

  await app.whenReady();
  hardenContents();
  const captureHost = new CaptureHostWindow();
  captureHost.install(session.defaultSession);

  const db = openDatabase(join(app.getPath('userData'), 'nova-capture.db'));
  const spoolDir = join(app.getPath('userData'), 'spool');
  const settings = new SettingsRepo(db);
  const secrets = new SecretStore(db, safeStorage);
  const sessions = new SessionsRepo(db);
  const jobs = new JobsRepo(db);
  const chunks = new TranscriptChunksRepo(db);
  const usage = new UsageRepo(db);
  const windows = new WindowManager();

  // Set below; the worker host's callbacks only fire after a capture starts.
  const ref: { orchestrator?: SessionOrchestrator<MessagePortMain> } = {};
  const workerHost = new WorkerHost<MessagePortMain>({
    spawn: () =>
      utilityProcess.fork(join(__dirname, 'worker.js'), [], { serviceName: 'Nova Audio Worker' }),
    onLevel: (_sessionId, dbfs) => {
      windows.send('capture:level', { dbfs });
    },
    onCaptureError: (sessionId, message) => {
      void ref.orchestrator?.captureLost(sessionId, message);
    },
  });
  const sessionOrchestrator = new SessionOrchestrator<MessagePortMain>({
    sessions,
    jobs,
    chunks,
    worker: workerHost,
    captureHost,
    createFramePorts: () => {
      const { port1, port2 } = new MessageChannelMain();
      return { hostPort: port1, workerPort: port2 };
    },
    spoolPathFor: (sessionId) => join(spoolDir, `${sessionId}.pcm`),
    newId: randomUUID,
    now: Date.now,
    emit: (event) => {
      windows.send('session:state', event);
    },
  });
  ref.orchestrator = sessionOrchestrator;

  const runner = new JobRunner({
    jobs,
    handlers: {
      transcribe_chunk: createTranscribeChunkHandler({
        sessions,
        chunks,
        usage,
        getProvider: () => createSttProvider(settings.get().sttProvider, secrets),
      }),
      generate_note: () =>
        Promise.reject(new ProviderError('Note generation arrives in Phase 3', 'llm', false)),
    },
    onSettled: (job, outcome) => {
      sessionOrchestrator.onJobSettled(job, outcome);
    },
  });

  registerIpcHandlers(
    ipcMain,
    createIpcHandlers({ settings, secrets, capture: sessionOrchestrator }),
    windows.isTrustedSender,
  );
  ipcMain.on(CAPTURE_HOST_CHANNELS.ended, (event, payload: unknown) => {
    const parsed = CaptureHostEndedSchema.safeParse(payload);
    const sessionId = sessionOrchestrator.activeSessionId;
    if (!captureHost.isCaptureHost(event.sender) || !parsed.success || sessionId === undefined) {
      return;
    }
    void sessionOrchestrator.captureLost(sessionId, parsed.data.reason);
  });

  app.on('before-quit', () => {
    runner.stop();
  });
  app.on('will-quit', () => {
    db.close();
  });
  app.on('second-instance', () => {
    windows.showMainWindow().catch((error: unknown) => {
      log.error('failed to show main window', { error: String(error) });
    });
  });

  await windows.showMainWindow();
  // Finish what a crash interrupted, then keep the queue moving (ARCHITECTURE.md §8).
  await sessionOrchestrator.recover();
  runner.start();
}

app.on('window-all-closed', () => {
  app.quit();
});

// electron-log arrives in Phase 6; until then fatal startup errors go to a dialog.
start().catch((error: unknown) => {
  dialog.showErrorBox('Nova Capture failed to start', String(error));
  app.exit(1);
});
