import { expect, test, type Page } from '@playwright/test';
import tr from '../../../apps/web/messages/tr.json' with { type: 'json' };
import { KITCHEN, goStep, openNewProject, paste } from '../wizard-helpers';
import {
  THEMES,
  VIEWPORTS,
  applyTheme,
  expectNoA11yViolations,
  snap,
  type ViewportName,
} from './helpers';

// B4 (T109–T111): the Oluştur wizard steps at 1440 and 390 px, light and dark, full-page axe.
// The visual run shares one fresh database with the page captures (Ana sayfa "fresh install"),
// so the wizard never writes: autosave requests are answered here, and the clock is fixed so the
// default project name ("Proje <tarih>") is stable.

const ID = 'visual-demo';
const NOW = new Date('2026-11-18T09:00:00+03:00');

// Every save answers revision 1, so the captures do not depend on how many autosaves ran.
async function mockSaves(page: Page): Promise<void> {
  const reply = () => ({ id: ID, revision: 1, updatedAt: NOW.toISOString() });
  await page.route('**/api/projects', (route) =>
    route.request().method() === 'POST' ? route.fulfill({ json: reply() }) : route.continue(),
  );
  await page.route(`**/api/projects/${ID}`, (route) =>
    route.request().method() === 'PUT' ? route.fulfill({ json: reply() }) : route.continue(),
  );
}

const HASH = 'a3f1c2d4e5b6978812ab34cd56ef7890a3f1c2d4e5b6978812ab34cd56ef7890';
const FILES = [1, 2, 3].map((n) => ({
  name: `NittCam_S${n}.tap`,
  size: 41_000 + n * 1_234,
  hash: HASH,
  sheet: n - 1,
}));

/** Step 5 talks to the server export (dry run + history); answered with fixed data here. */
async function mockExport(page: Page): Promise<void> {
  await page.route(`**/api/projects/${ID}/export?*`, (route) =>
    route.fulfill({
      json: {
        ok: true,
        stage: 'done',
        revision: 1,
        violations: [],
        files: FILES,
        needsAcceptance: true,
        unverifiedReasons: ['profile', 'example'],
        profile: {
          machineId: 'seed',
          machineName: 'Örnek router (Mach3)',
          profileVersionId: 'seed-v1',
          version: 1,
          latestVersion: 1,
          verification: 'draft',
          example: true,
        },
        post: { id: 'mach3', version: '1.0.0', name: 'Mach3' },
        checklist: {
          origin: {
            corner: 'frontLeft',
            xPositive: 'right',
            yPositive: 'back',
            sheetOffset: { x: 0, y: 0 },
          },
          zReference: 'table',
          tools: [{ number: 2, diameter: 8, type: 'flat' }],
        },
      },
    }),
  );
  await page.route(`**/api/projects/${ID}/exports`, (route) =>
    route.fulfill({
      json: [
        {
          exportId: 'e1',
          projectId: ID,
          revision: 1,
          createdAt: NOW.toISOString(),
          profileVersionId: 'seed-v1',
          profileVersion: 1,
          post: { id: 'mach3', version: '1.0.0' },
          verification: 'draft',
          unverified: true,
          acceptedUnverifiedAt: NOW.toISOString(),
          hash: HASH,
          files: FILES.map((file) => ({
            ...file,
            downloadUrl: `/api/exports/e1/files/${file.name}`,
          })),
        },
      ],
    }),
  );
}

for (const vp of Object.keys(VIEWPORTS) as ViewportName[]) {
  for (const theme of THEMES) {
    test.describe(`wizard ${vp} ${theme}`, () => {
      test.use({ viewport: VIEWPORTS[vp] });

      test.beforeEach(async ({ page }) => {
        await page.clock.setFixedTime(NOW);
        await applyTheme(page, theme);
        await mockSaves(page);
        await mockExport(page);
      });

      test('steps 1–5: machine, parts, layout, simulation, export (T109–T111)', async ({
        page,
      }) => {
        await openNewProject(page, 'makine');
        await expect(page.getByTestId('sheet-preview')).toBeVisible();
        await expectNoA11yViolations(page);
        await snap(page, `t109-wizard-machine-${vp}-${theme}`, { fullPage: false });

        await goStep(page, 'parcalar');
        await paste(page, KITCHEN, 5);
        await expect(page.getByTestId('cut-list-count')).toContainText('30');
        // The first autosave (mocked) moves the URL to /projeler/<id>; the sidebar highlight and
        // the breadcrumb follow it, so capture only after that has happened.
        await page.waitForURL(`**/projeler/${ID}?*`);
        await page.mouse.move(0, 0);
        await expectNoA11yViolations(page);
        await snap(page, `t109-wizard-parts-${vp}-${theme}`, { fullPage: false });
        await expect(page.getByRole('heading', { name: tr.cutList.tableLabel })).toBeVisible();

        await goStep(page, 'dizilim');
        await page.getByRole('button', { name: tr.cutList.nesting.run, exact: true }).click();
        await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
        await page.mouse.move(0, 0);
        await expectNoA11yViolations(page);
        await snap(page, `t110-wizard-layout-${vp}-${theme}`, { fullPage: false });

        await goStep(page, 'simulasyon');
        await expect(page.getByTestId('sim-check-status')).toBeVisible({ timeout: 30_000 });
        await page.mouse.move(0, 0);
        await expectNoA11yViolations(page);
        await snap(page, `t110-wizard-simulation-${vp}-${theme}`, { fullPage: false });

        await goStep(page, 'export');
        await expect(page.getByTestId('export-status')).toHaveAttribute('data-ok', 'true', {
          timeout: 30_000,
        });
        await expect(page.getByTestId('export-history-row')).toHaveCount(1);
        await page.getByTestId('export-check-origin').check();
        await page.mouse.move(0, 0);
        await expectNoA11yViolations(page);
        await snap(page, `t111-wizard-export-${vp}-${theme}`, { fullPage: false });
        await page.getByTestId('export-checklist').scrollIntoViewIfNeeded();
        await snap(page, `t111-wizard-export-checklist-${vp}-${theme}`, { fullPage: false });
      });
    });
  }
}
