import { expect, test } from '@playwright/test';
import tr from '../../../apps/web/messages/tr.json' with { type: 'json' };
import {
  THEMES,
  VIEWPORTS,
  applyTheme,
  expectNoA11yViolations,
  settle,
  snap,
  type ViewportName,
} from './helpers';

// T102: the /dev/ui gallery in every viewport and theme, plus open overlays; screenshots + axe.
const t = tr.devUi;

for (const vp of Object.keys(VIEWPORTS) as ViewportName[]) {
  for (const theme of THEMES) {
    test.describe(`/dev/ui ${vp} ${theme}`, () => {
      test.use({ viewport: VIEWPORTS[vp] });

      test.beforeEach(async ({ page }) => {
        await applyTheme(page, theme);
        await page.goto('/dev/ui');
        await expect(page.getByRole('heading', { level: 1, name: t.title })).toBeVisible();
      });

      test('page: theme applied, no horizontal scroll, no axe violations', async ({ page }) => {
        await expect(page.locator('html')).toHaveClass(new RegExp(`(^| )${theme}( |$)`));
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, 'page-level horizontal scroll').toBeLessThanOrEqual(0);
        await expectNoA11yViolations(page);
        await snap(page, `t102-gallery-${vp}-${theme}`);
      });

      test('overlays: dialog, menu, select, sheet, alert', async ({ page }) => {
        const overlays = [
          { name: 'dialog', open: t.overlays.dialogTrigger, role: 'dialog' as const },
          { name: 'alert', open: t.overlays.alertTrigger, role: 'alertdialog' as const },
          { name: 'sheet', open: t.overlays.sheetTrigger, role: 'dialog' as const },
          { name: 'menu', open: t.overlays.menuTrigger, role: 'menu' as const, anchored: true },
          {
            name: 'popover',
            open: t.overlays.popoverTrigger,
            role: 'dialog' as const,
            anchored: true,
          },
        ];
        for (const o of overlays) {
          // Same scroll position behind every overlay (focus restore after Escape moves it).
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.getByRole('button', { name: o.open, exact: true }).click();
          await expect(page.getByRole(o.role)).toBeVisible();
          // Modal layers aria-hide the page behind them (focus is trapped), so axe checks the layer.
          await expectNoA11yViolations(page, { include: `[role="${o.role}"]` });
          await snap(page, `t102-${o.name}-${vp}-${theme}`, {
            fullPage: false,
            keepScroll: 'anchored' in o,
          });
          await page.keyboard.press('Escape');
          await expect(page.getByRole(o.role)).toHaveCount(0);
        }
        await page.getByRole('combobox', { name: t.form.material }).click();
        await expect(page.getByRole('listbox')).toBeVisible();
        await snap(page, `t102-select-${vp}-${theme}`, { fullPage: false, keepScroll: true });
        await page.keyboard.press('Escape');
      });
    });
  }
}

test.describe('/dev/ui theme switching', () => {
  test('stored choice survives a reload with no light flash', async ({ page }) => {
    await page.goto('/dev/ui');
    await page.getByRole('radio', { name: t.theme.dark }).click();
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    // The class must be on <html> before any React code runs: check the first parsed state.
    await page.addInitScript(() => {
      document.addEventListener(
        'DOMContentLoaded',
        () => {
          (window as unknown as { __firstClass: string }).__firstClass =
            document.documentElement.className;
        },
        { once: true },
      );
    });
    await page.reload();
    await settle(page);
    const first = await page.evaluate(
      () => (window as unknown as { __firstClass?: string }).__firstClass ?? '',
    );
    expect(first).toMatch(/\bdark\b/);
    await expect(page.getByRole('radio', { name: t.theme.dark })).toBeChecked();
    await page.getByRole('radio', { name: t.theme.light }).click();
    await expect(page.locator('html')).toHaveClass(/\blight\b/);
  });
});
