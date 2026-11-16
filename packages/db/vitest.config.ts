import { defineConfig } from 'vitest/config';

// PGlite boots a WASM Postgres per test file; on a cold or busy machine that can exceed the
// 5 s default, so database tests get a longer timeout.
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
