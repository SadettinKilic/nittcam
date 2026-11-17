import { expect, test } from '@playwright/test';
import {
  THEMES,
  VIEWPORTS,
  applyTheme,
  expectNoA11yViolations,
  snap,
  type ViewportName,
} from './helpers';

// T105: 404 page and the Projeler empty / error states at 1440 and 390 px, light and dark.
for (const vp of Object.keys(VIEWPORTS) as ViewportName[]) {
  for (const theme of THEMES) {
    test.describe(`feedback ${vp} ${theme}`, () => {
      test.use({ viewport: VIEWPORTS[vp] });

      test.beforeEach(async ({ page }) => {
        await applyTheme(page, theme);
      });

      test('404 page', async ({ page }) => {
        await page.goto('/boyle-bir-sayfa-yok');
        await expect(page.getByTestId('not-found')).toBeVisible();
        await expectNoA11yViolations(page);
        await snap(page, `t105-404-${vp}-${theme}`, { fullPage: false });
      });

      test('Projeler empty and error states', async ({ page }) => {
        let fail = false;
        await page.route('**/api/projects', (route) =>
          fail ? route.fulfill({ status: 500, json: {} }) : route.fulfill({ json: [] }),
        );
        await page.goto('/projeler');
        const empty = page.getByTestId('projects-empty');
        await expect(empty).toBeVisible();
        await expectNoA11yViolations(page, { include: '[data-testid="projects-empty"]' });
        await snap(page, `t105-empty-${vp}-${theme}`, { fullPage: false });
        fail = true;
        await page.reload();
        const error = page.getByTestId('projects-error');
        await expect(error).toBeVisible();
        await expectNoA11yViolations(page, { include: '[data-testid="projects-error"]' });
        await snap(page, `t105-error-${vp}-${theme}`, { fullPage: false });
      });
    });
  }
}
