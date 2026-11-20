import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { goStep, openNewProject, paste } from './wizard-helpers';

/** Tester (B25): offcuts only after "Stoğa kaydet"; axe on the changed screens; 390 px smoke. */

async function axeClean(page: Page) {
  // Tab panels fade in (animate-fade-in): measure contrast after the animation, not mid-fade.
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running'),
  );
  const res = await new AxeBuilder({ page }).analyze();
  const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
  expect(bad.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
}
const noHScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

for (const vp of [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
]) {
  test(`offcuts: nothing stored before save; axe + layout at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    // Other specs share the CI database and may have saved offcuts: compare before/after.
    await page.goto('/projeler');
    await page.getByTestId('offcuts-tab').click();
    // Count only once the list has loaded (a count during loading read 0, then 2 rows came).
    await expect(page.getByTestId('offcuts-loading')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId('offcut-add')).toBeVisible();
    const before = await page.getByTestId('offcut-row').count();
    await openNewProject(page, 'parcalar');
    await paste(page, 'Ad\tEn\tBoy\tAdet\nYan\t600\t500\t2', 1);
    await goStep(page, 'dizilim');
    if (vp.width > 600) {
      await expect(page.getByTestId('nesting-sheets')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId('offcut-proposals')).toBeVisible();
    } else await expect(page.getByRole('heading', { name: 'Dizilim', level: 1 })).toBeVisible();
    await axeClean(page);
    expect(await noHScroll(page)).toBe(true);

    // Proposed only: the stock tab has no row until the user saves.
    await page.goto('/projeler');
    await page.getByTestId('offcuts-tab').click();
    // Count only once the list has loaded (same as above).
    await expect(page.getByTestId('offcuts-loading')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId('offcut-add')).toBeVisible();
    await expect(page.getByTestId('offcut-row')).toHaveCount(before);
    await axeClean(page);
    expect(await noHScroll(page)).toBe(true);
  });
}
