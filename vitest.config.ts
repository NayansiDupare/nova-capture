import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['packages/core/src/**/*.ts'],
      exclude: ['**/*.test.ts'],
      // TESTING.md §6. Add thresholds for apps/desktop once it has testable logic.
      thresholds: {
        'packages/core/src/**': { lines: 90 },
      },
    },
  },
});
