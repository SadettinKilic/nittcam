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
    });
  }
}
