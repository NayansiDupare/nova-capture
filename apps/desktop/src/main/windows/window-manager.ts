import { join } from 'node:path';

import { app, BrowserWindow } from 'electron';
import type { WebPreferences } from 'electron';

import { IPC_EVENTS } from '@nova/core';
import type { IpcEvent, IpcEventPayload } from '@nova/core';

import { loadPage } from './load-page';
import type { InvokeEvent } from '../ipc/ipc-router';
import { isTrustedSender } from '../ipc/trusted-sender';

/** SECURITY.md §3.1: every window gets these. Only `preload` differs between window types. */
export function secureWebPreferences(preload: string): WebPreferences {
  return {
    preload,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    experimentalFeatures: false,
    spellcheck: false,
    devTools: !app.isPackaged,
  };
}

/**
 * Creates and tracks the app's windows. Owns the set of webContents allowed to call IPC,
 * so a window is trusted exactly while it exists.
 */
export class WindowManager {
  private mainWindow: BrowserWindow | undefined;
  private readonly trustedWebContentsIds = new Set<number>();

  readonly isTrustedSender = (event: InvokeEvent): boolean =>
    isTrustedSender(event, this.trustedWebContentsIds);

  /** Shows the main window, creating it if needed. */
  async showMainWindow(): Promise<void> {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      if (this.mainWindow.isMinimized()) {
        this.mainWindow.restore();
      }
      this.mainWindow.focus();
      return;
    }
    const win = new BrowserWindow({
      width: 1100,
      height: 720,
      minWidth: 880,
      minHeight: 600,
      show: false,
      title: 'Nova Capture',
      webPreferences: secureWebPreferences(join(__dirname, '../preload/main-ui.js')),
    });
    // Assigned before the await so a second call during loading reuses this window.
    this.mainWindow = win;
    this.trust(win);
    win.once('ready-to-show', () => {
      win.show();
    });

    await loadPage(win, 'main-ui');
  }

  /** Sends a validated main → UI event to the main window, if it is open. */
  send<E extends IpcEvent>(event: E, payload: IpcEventPayload<E>): void {
    const win = this.mainWindow;
    if (!win || win.isDestroyed()) {
      return;
    }
    win.webContents.send(event, IPC_EVENTS[event].parse(payload));
  }

  private trust(win: BrowserWindow): void {
    const id = win.webContents.id;
    this.trustedWebContentsIds.add(id);
    win.webContents.once('destroyed', () => {
      this.trustedWebContentsIds.delete(id);
    });
  }
}
