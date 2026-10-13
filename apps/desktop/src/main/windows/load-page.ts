import { join } from 'node:path';

import { app } from 'electron';
import type { BrowserWindow } from 'electron';

export type RendererPage = 'main-ui' | 'capture-host';

/** Loads a renderer page from the dev server in development, or from the built files. */
export async function loadPage(win: BrowserWindow, page: RendererPage): Promise<void> {
  const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devServerUrl) {
    await win.loadURL(`${devServerUrl}/${page}/index.html`);
  } else {
    await win.loadFile(join(__dirname, `../renderer/${page}/index.html`));
  }
}
