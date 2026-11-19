import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // fast-check: seed always reported, FC_SEED/FC_PATH replay, no time limits (T273)
    setupFiles: ['src/testing/fast-check.setup.ts'],
    // T273: core is pure and deterministic, so the result never depends on the clock. The
    // default 5 s timeout made property tests fail on a slow or busy runner; this is a hang guard.
    testTimeout: 300_000,
  },
});
