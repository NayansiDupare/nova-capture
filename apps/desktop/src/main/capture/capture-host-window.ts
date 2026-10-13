import { join } from 'node:path';

import { BrowserWindow, desktopCapturer, webContents } from 'electron';
import type { MessagePortMain, Session, WebContents, WebFrameMain } from 'electron';

import { CAPTURE_HOST_CHANNELS } from '@nova/core';

import { log } from '../log';
import type { CaptureHostControl } from '../session/orchestrator';
import { loadPage } from '../windows/load-page';
import { secureWebPreferences } from '../windows/window-manager';

/** Only these permissions are granted, and only to the Capture Host (SECURITY.md §3.2). */
const CAPTURE_PERMISSIONS = new Set(['media', 'display-capture']);

/**
 * The hidden window that runs `getDisplayMedia` with loopback audio (ARCHITECTURE.md §5.2).
 * It survives main-UI reloads, and its frames go straight to the Audio Worker.
 */
export class CaptureHostWindow implements CaptureHostControl<MessagePortMain> {
  private window: BrowserWindow | undefined;
  private loading: Promise<BrowserWindow> | undefined;

  /** True if `contents` is the Capture Host's own page. */
  isCaptureHost(contents: WebContents | undefined): boolean {
    return contents !== undefined && this.window?.webContents.id === contents.id;
  }

  isCaptureHostFrame(frame: WebFrameMain | null): boolean {
    return (
      frame !== null && frame.parent === null && this.isCaptureHost(webContents.fromFrame(frame))
    );
  }

  /**
   * Lets the Capture Host, and nothing else, capture the screen's audio. The video track is
   * required by `getDisplayMedia`; the page stops it immediately.
   */
  install(session: Session): void {
    session.setPermissionRequestHandler((contents, permission, callback) => {
      callback(CAPTURE_PERMISSIONS.has(permission) && this.isCaptureHost(contents));
    });
    session.setPermissionCheckHandler(
      (contents, permission) =>
        CAPTURE_PERMISSIONS.has(permission) && this.isCaptureHost(contents ?? undefined),
    );
    session.setDisplayMediaRequestHandler((request, callback) => {
      if (!this.isCaptureHostFrame(request.frame)) {
        log.warn('denied display media request from outside the capture host');
        callback(null);
        return;
      }
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => {
          const screen = sources[0];
          callback(screen ? { video: screen, audio: 'loopback' } : null);
        })
        .catch((error: unknown) => {
          log.error('desktopCapturer.getSources failed', { error: String(error) });
          callback(null);
        });
    });
  }

  async start(framePort: MessagePortMain): Promise<void> {
    const win = await this.ensureWindow();
    win.webContents.postMessage(CAPTURE_HOST_CHANNELS.port, null, [framePort]);
    // userGesture: getDisplayMedia needs transient activation (verified in the Phase 0 spike).
    await win.webContents.executeJavaScript('window.novaCaptureHost.start()', true);
  }

  async stop(): Promise<void> {
    if (!this.window || this.window.isDestroyed()) {
      return;
    }
    await this.window.webContents.executeJavaScript('window.novaCaptureHost.stop()');
  }

  private ensureWindow(): Promise<BrowserWindow> {
    if (this.window && !this.window.isDestroyed()) {
      return this.loading ?? Promise.resolve(this.window);
    }
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        ...secureWebPreferences(join(__dirname, '../preload/capture-host.js')),
        // Hidden windows are throttled by default; capture must keep running.
        backgroundThrottling: false,
      },
    });
    this.window = win;
    win.webContents.on('render-process-gone', (_event, details) => {
      log.error('capture host renderer gone', { reason: details.reason });
    });
    win.on('closed', () => {
      if (this.window === win) {
        this.window = undefined;
        this.loading = undefined;
      }
    });
    this.loading = loadPage(win, 'capture-host').then(() => win);
    return this.loading;
  }
}
