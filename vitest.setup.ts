import { vi } from 'vitest';

// TESTING.md §5: no network in unit, pipeline, repository or contract tests.
vi.stubGlobal('fetch', () => {
  throw new Error('Network access is blocked in tests (TESTING.md §5). Use a fake or a recording.');
});
