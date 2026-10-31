import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'packages/core/src/**/*.ts',
        // Main-process logic that runs without Electron. Windows and app wiring are covered by E2E.
        'apps/desktop/src/main/{db,ipc,secrets,capture,jobs,notes,providers,session,spool}/**/*.ts',
        // The worker entry (index.ts) is utility-process plumbing; its logic lives in testable modules.
        'apps/desktop/src/worker/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.d.ts',
        '**/__tests__/**',
        'apps/desktop/src/worker/index.ts',
        // Electron window plumbing; verified by running the app (E2E arrives in Phase 6).
        'apps/desktop/src/main/capture/capture-host-window.ts',
      ],
      // TESTING.md §6.
      thresholds: {
        'packages/core/src/**': { lines: 90 },
        'apps/desktop/src/main/**': { lines: 75 },
        'apps/desktop/src/worker/**': { lines: 80 },
      },
    },
  },
});
