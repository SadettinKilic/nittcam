import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

// Unit tests of the web app: pure client logic (autosave queue) and the route handlers against an
// in-memory PGlite database (the server helper reads PGLITE_DIR; 'memory' = no files).
export default defineConfig({
  // Component tests (.test.tsx) render with react-dom/server; tsconfig keeps JSX for Next.
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts', 'app/**/*.test.tsx'],
    // Export files (T021) go to a fresh temporary folder per run.
    env: {
      PGLITE_DIR: 'memory',
      STORAGE_DIR: join(tmpdir(), `nittcam-test-storage-${Date.now()}`),
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
