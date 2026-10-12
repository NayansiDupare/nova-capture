import { join } from 'node:path';

import { app, dialog, ipcMain, safeStorage, session } from 'electron';

import { openDatabase } from './db/open-database';
import { SettingsRepo } from './db/settings-repo';
import { createIpcHandlers } from './ipc/handlers';
import { registerIpcHandlers } from './ipc/ipc-router';
import { log } from './log';
import { SecretStore } from './secrets/secret-store';
import { WindowManager } from './windows/window-manager';

/** SECURITY.md §3.2: no navigation, no new windows, no webviews, no permissions. */
function hardenSessionAndContents(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);

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
  hardenSessionAndContents();

  const db = openDatabase(join(app.getPath('userData'), 'nova-capture.db'));
  app.on('will-quit', () => {
    db.close();
  });

  const windows = new WindowManager();
  registerIpcHandlers(
    ipcMain,
    createIpcHandlers({
      settings: new SettingsRepo(db),
      secrets: new SecretStore(db, safeStorage),
    }),
    windows.isTrustedSender,
  );

  app.on('second-instance', () => {
    windows.showMainWindow().catch((error: unknown) => {
      log.error('failed to show main window', { error: String(error) });
    });
  });
  await windows.showMainWindow();
}

app.on('window-all-closed', () => {
  app.quit();
});

// electron-log arrives in Phase 6; until then fatal startup errors go to a dialog.
start().catch((error: unknown) => {
  dialog.showErrorBox('Nova Capture failed to start', String(error));
  app.exit(1);
});
