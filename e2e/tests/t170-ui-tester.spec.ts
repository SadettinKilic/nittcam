import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { goStep, openNewProject, paste } from './wizard-helpers';

/** Tester (T170): axe on the layout screen with a multi-selection; 390 px smoke. */

test('layout screen: axe clean at 1440, no page scroll at 390', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await paste(page, 'Ad\tEn\tBoy\tAdet\nYan\t600\t500\t3', 1);
  await goStep(page, 'dizilim');
  await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid=layout-canvas] canvas').first()).toBeVisible();
  const res = await new AxeBuilder({ page }).analyze();
  const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
  expect(bad.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Dizilim', level: 1 })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
});
