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

// T103: the app shell (sidebar / drawer, top bar) at 1440 and 390 px, light and dark.
const PAGES = ['/', '/projeler', '/makineler'] as const;
const SHELL = ['[data-testid="shell-topbar"]', '[data-testid="shell-sidebar"]'];

for (const vp of Object.keys(VIEWPORTS) as ViewportName[]) {
  for (const theme of THEMES) {
    test.describe(`shell ${vp} ${theme}`, () => {
      test.use({ viewport: VIEWPORTS[vp] });

      test.beforeEach(async ({ page }) => {
        await applyTheme(page, theme);
      });

      test('pages fit the viewport and pass axe', async ({ page }) => {
        for (const path of PAGES) {
          await page.goto(path);
          await expect(page.getByTestId('shell-topbar')).toBeVisible();
          await page.waitForLoadState('networkidle');
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          expect(overflow, `horizontal scroll on ${path}`).toBeLessThanOrEqual(0);
          // The page bodies are redesigned in B3/B4; here axe checks the shell itself.
          for (const region of SHELL) await expectNoA11yViolations(page, { include: region });
        }
        await page.goto('/');
        await expect(page.getByTestId('shell-title')).toHaveText(tr.nav.home);
        await snap(page, `t103-shell-${vp}-${theme}`, { fullPage: false });
      });

      test('command palette and shortcut help (T104)', async ({ page }) => {
        await page.route('**/api/projects', (route) => route.fulfill({ json: [] }));
        await page.goto('/');
        await expect(page.getByTestId('shell-topbar')).toBeVisible();
        await page.keyboard.press('Control+k');
        const palette = page.getByTestId('command-palette');
        await expect(palette).toBeVisible();
        await expectNoA11yViolations(page, { include: '[data-testid="command-palette"]' });
        await snap(page, `t104-palette-${vp}-${theme}`, { fullPage: false });
        await page.keyboard.press('Escape');
        await expect(palette).toHaveCount(0);
        await page.keyboard.press('Shift+?');
        const help = page.getByTestId('shortcuts-dialog');
        await expect(help).toBeVisible();
        await expectNoA11yViolations(page, { include: '[data-testid="shortcuts-dialog"]' });
        await snap(page, `t104-shortcuts-${vp}-${theme}`, { fullPage: false });
      });

      if (vp === 'mobile') {
        test('drawer menu', async ({ page }) => {
          await page.goto('/');
          await page.getByRole('button', { name: tr.shell.openMenu }).click();
          const drawer = page.getByTestId('shell-drawer');
          await expect(drawer).toBeVisible();
          await expectNoA11yViolations(page, { include: '[data-testid="shell-drawer"]' });
          await snap(page, `t103-drawer-${vp}-${theme}`, { fullPage: false });
        });
      } else {
        test('collapsed sidebar', async ({ page }) => {
          await page.goto('/');
          await page.getByTestId('sidebar-toggle').click();
          await expect(page.locator('html')).toHaveAttribute('data-sidebar', 'collapsed');
          await page.mouse.move(700, 450);
          await snap(page, `t103-collapsed-${vp}-${theme}`, { fullPage: false });
        });
      }
    });
  }
}
