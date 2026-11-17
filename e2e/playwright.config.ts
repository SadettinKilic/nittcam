import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
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
  },
  // Visual baselines (T102, D-032): compared only on Linux (CI) because font rendering differs
  // on Windows/macOS. Missing baselines are written on the CI run and uploaded as an artefact;
  // the PO commits them to e2e/visual-baselines/ to lock them in.
  snapshotPathTemplate: '{testDir}/../visual-baselines/{arg}{ext}',
  updateSnapshots: 'missing',
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
