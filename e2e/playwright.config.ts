import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// E2E_PORT: a second checkout (parallel worktree, D-042) runs its own server beside the first.
const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://localhost:${PORT}`;
// A fresh PGlite database per run, so the Makineler tests start from the seeded example only.
const PGLITE_DIR = process.env.E2E_PGLITE_DIR ?? join(tmpdir(), `nittcam-e2e-${Date.now()}`);

// The root `pnpm e2e` builds the web app first; here we only start the production server.
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    locale: 'tr-TR',
    trace: 'on-first-retry',
    // T136: the editor's first-use tour is marked as seen, so it never covers the board in other
    // specs; the tour's own spec starts from empty storage (`test.use({ storageState: ... })`).
    storageState: {
      cookies: [],
      origins: [
        { origin: baseURL, localStorage: [{ name: 'nittcam-editor-tour', value: 'done' }] },
      ],
    },
  },
  // Visual baselines (T102, D-032): compared only on Linux (CI) because font rendering differs
  // on Windows/macOS. T199a: in CI a missing baseline FAILS (updateSnapshots 'none') instead of
  // being written silently; the failing run's actual images are copied into the
  // visual-screenshots artefact as candidate baselines (tools/ci/visual-candidates.mjs), and the
  // tester commits the reviewed ones to e2e/visual-baselines/. Locally (and with
  // VISUAL_UPDATE=missing) missing baselines are still written.
  snapshotPathTemplate: '{testDir}/../visual-baselines/{arg}{ext}',
  // D-048: VISUAL_UPDATE=changed is the CI baseline-refresh mode (`gh workflow run CI -f
  // baselines=update`): changed and missing baselines are rewritten and committed by CI.
  updateSnapshots:
    process.env.VISUAL_UPDATE === 'changed'
      ? 'changed'
      : process.env.CI && process.env.VISUAL_UPDATE !== 'missing'
        ? 'none'
        : 'missing',
  expect: {
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixels: 0 },
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: ['visual/**'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // pnpm e2e:visual: /dev/ui (and later every screen) at 1440 and 390 px, light and dark,
      // screenshots + axe. Reduced motion keeps captures deterministic.
      name: 'visual',
      testMatch: ['visual/**/*.spec.ts'],
      use: { ...devices['Desktop Chrome'], reducedMotion: 'reduce' },
    },
  ],
  webServer: {
    command: `pnpm --filter @nittcam/web start --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // NITTCAM_UI_GALLERY: the dev-only /dev/ui gallery is served by the production build here.
    env: { PGLITE_DIR, NITTCAM_UI_GALLERY: '1' },
  },
});
