import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

/**
 * Vite's dev server needs inline scripts (React refresh preamble), injected styles and a
 * websocket. SECURITY.md §3.3 allows relaxing the CSP for HMR in dev only.
 */
function relaxCspInDev(): Plugin {
  return {
    name: 'nova:relax-csp-in-dev',
    apply: 'serve',
    transformIndexHtml(html) {
      return html
        .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
        .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
        .replace("connect-src 'self'", "connect-src 'self' ws://localhost:*");
    },
  };
}

export default defineConfig({
  main: {
    build: {
      // @nova/core ships TypeScript source, so it must be bundled rather than required at runtime.
      externalizeDeps: { exclude: ['@nova/core'] },
      rollupOptions: {
        input: { index: resolve('src/main/index.ts'), worker: resolve('src/worker/index.ts') },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: { exclude: ['@nova/core'] },
      rollupOptions: {
        input: {
          'main-ui': resolve('src/preload/main-ui.ts'),
          'capture-host': resolve('src/preload/capture-host.ts'),
        },
      },
    },
  },
  renderer: {
    // Two pages: the React main UI and the framework-free Capture Host (ARCHITECTURE.md §3).
    root: resolve('src/renderer'),
    plugins: [react(), relaxCspInDev()],
    build: {
      rollupOptions: {
        input: {
          'main-ui': resolve('src/renderer/main-ui/index.html'),
          'capture-host': resolve('src/renderer/capture-host/index.html'),
        },
      },
    },
  },
});
