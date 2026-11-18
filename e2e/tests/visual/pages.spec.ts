import { expect, test } from '@playwright/test';
import tr from '../../../apps/web/messages/tr.json' with { type: 'json' };
import {
  THEMES,
  VIEWPORTS,
  applyTheme,
  expectNoA11yViolations,
  snap,
  type ViewportName,
} from './helpers';

// B3 (T106–T108): redesigned page bodies at 1440 and 390 px, light and dark, full-page axe.
// The visual run starts from a fresh database (only the seeded example machine) and no visual
// test writes data, so these captures are deterministic.

const AT = '2026-11-18T06:00:00.000Z';
const HASH = 'a3f1c2d4e5b6978812ab34cd56ef7890a3f1c2d4e5b6978812ab34cd56ef7890';
const item = (
  id: string,
  name: string,
  status: 'draft' | 'produced' | 'completed',
  pieces: number,
  exported: boolean,
) => ({
  id,
  name,
  status,
  revision: 3,
  updatedAt: AT,
  machine: 'Örnek router (Mach3)',
  material: 'mdf',
  thickness: 18,
  sheet: { width: 2800, height: 2070 },
  pieces,
  lastExport: exported
    ? {
        exportId: `e-${id}`,
        projectId: id,
        revision: 3,
        createdAt: AT,
        profileVersionId: 'v1',
        profileVersion: 1,
        post: { id: 'mach3', version: '1.0.0' },
        verification: 'verified',
        unverified: false,
        acceptedUnverifiedAt: null,
        hash: HASH,
        files: [
          {
            name: 'S1.tap',
            size: 41000,
            hash: HASH,
            sheet: 0,
            downloadUrl: '/api/exports/x/S1.tap',
          },
        ],
      }
    : null,
});
const PROJECTS = [
  item('p1', 'Mutfak dolabı', 'completed', 30, true),
  item('p2', 'Gardırop kapakları', 'produced', 12, true),
  item('p3', 'Ofis rafı', 'draft', 8, false),
];

for (const vp of Object.keys(VIEWPORTS) as ViewportName[]) {
  for (const theme of THEMES) {
    test.describe(`pages ${vp} ${theme}`, () => {
      test.use({ viewport: VIEWPORTS[vp] });

      test.beforeEach(async ({ page }) => {
        await applyTheme(page, theme);
      });

      test('home: fresh install (T106)', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(tr.home.title);
        await expect(page.getByTestId('home-projects-empty')).toBeVisible();
        await expect(page.getByTestId('home-machines')).toBeVisible();
        // T194a: zero projects → start strip instead of KPIs; one accent "Yeni proje" (sidebar).
        await expect(page.getByTestId('home-start')).toBeVisible();
        if (vp === 'desktop') await expect(page.getByTestId('home-new-project')).toBeHidden();
        await expectNoA11yViolations(page);
        await snap(page, `t106-home-empty-${vp}-${theme}`);
      });

      test('machines: list and profile form (T107)', async ({ page }) => {
        await page.goto('/makineler');
        await expect(page.getByTestId('machine-list')).toBeVisible();
        await expectNoA11yViolations(page);
        await snap(page, `t107-machines-${vp}-${theme}`);
        await page
          .getByRole('button', { name: new RegExp(`^${tr.machines.edit}:`) })
          .first()
          .click();
        await expect(page.getByTestId('machine-form')).toBeVisible();
        await expectNoA11yViolations(page);
        await snap(page, `t107-form-${vp}-${theme}`, { fullPage: false });
      });

      test('verification: stepper, download cards, checklist (T108)', async ({ page }) => {
        await page.goto('/makineler');
        await page.getByTestId('machine-list').waitFor();
        await page
          .getByTestId('machine-list')
          .getByRole('link', { name: new RegExp('^' + tr.machines.verify + ':') })
          .first()
          .click();
        await expect(page.getByTestId('verification-stepper')).toBeVisible();
        await expect(page.getByTestId('air-cut-download')).toBeDisabled();
        await expectNoA11yViolations(page);
        await snap(page, 't108-verification-' + vp + '-' + theme);
      });

      test('projects: empty list and a filled list (T111)', async ({ page }) => {
        await page.goto('/projeler');
        await expect(page.getByTestId('projects-empty')).toBeVisible();
        await expectNoA11yViolations(page);
        await snap(page, `t111-projects-empty-${vp}-${theme}`);

        // The filled list comes from a fixed answer (the visual run never writes projects).
        await page.route('**/api/projects', (route) =>
          route.request().method() === 'GET' ? route.fulfill({ json: PROJECTS }) : route.continue(),
        );
        await page.reload();
        await expect(page.getByTestId('project-row')).toHaveCount(PROJECTS.length);
        await expectNoA11yViolations(page);
        await snap(page, `t111-projects-${vp}-${theme}`);
      });
    });
  }
}
