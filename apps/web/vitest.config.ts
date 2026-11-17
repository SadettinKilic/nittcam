import { defineConfig } from 'vitest/config';

// Unit tests of the web app: pure client logic (autosave queue) and the route handlers against an
// in-memory PGlite database (the server helper reads PGLITE_DIR; 'memory' = no files).
export default defineConfig({
  test: {
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts'],
    env: { PGLITE_DIR: 'memory' },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
