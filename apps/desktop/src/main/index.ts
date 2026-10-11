import { join } from 'node:path';

import { app, BrowserWindow, dialog, session } from 'electron';

const isDev = !app.isPackaged;

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

async function createMainWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 880,
    minHeight: 600,
    show: false,
    title: 'Nova Capture',
    webPreferences: {
      preload: join(__dirname, '../preload/main-ui.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false,
      devTools: isDev,
    },
  });
  win.once('ready-to-show', () => {
    win.show();
  });

  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (isDev && devServerUrl) {
    await win.loadURL(devServerUrl);
  } else {
    await win.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return win;
}

async function start(): Promise<void> {
  await app.whenReady();
  hardenSessionAndContents();
  await createMainWindow();
}

app.on('window-all-closed', () => {
  app.quit();
});

// No logger yet (electron-log arrives in Phase 6), so fatal startup errors go to a dialog.
start().catch((error: unknown) => {
  dialog.showErrorBox('Nova Capture failed to start', String(error));
  app.exit(1);
});
