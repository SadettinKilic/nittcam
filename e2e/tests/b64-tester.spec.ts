import { expect, test } from '@playwright/test';
import {
  openNewProject,
  openThinSkinProject,
  openWorkspacePanel,
  pasteAndNest,
} from './wizard-helpers';

/**
 * B64 tester (PR #205, T338, D-129): the step 3 tab-spacing note shows with tabs and is gone with
 * "Köprü: Kapalı" (thin skin, stored 0,1 nests); no sideways page scroll at 390.
 */
const PARTS = 'Ad\tEn\tBoy\tAdet\nYan\t300\t500\t4';

test('tabs: note + effective pay; thin skin: no note, stored 0,1 (1440)', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page, PARTS, 1);
  const panel = await openWorkspacePanel(page, 'left');
  await expect(panel.getByTestId('layout-tab-spacing-note')).toBeVisible();
  const gapText = (await panel.getByTestId('layout-gap-note').textContent()) ?? '';
  expect(gapText).toMatch(/19,1 mm/);
});

test('thin skin: no tab-spacing note, clear distance = Ø + stored pay (1440)', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openThinSkinProject(page);
  await pasteAndNest(page, PARTS, 1);
  const panel = await openWorkspacePanel(page, 'left');
  await expect(panel.getByTestId('layout-tab-spacing-note')).toHaveCount(0);
  await expect(panel.getByTestId('layout-gap-note')).toContainText('8,1 mm');
});

test('390 px: the note shows and the page does not scroll sideways', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page, PARTS, 1);
  const panel = await openWorkspacePanel(page, 'left');
  await expect(panel.getByTestId('layout-tab-spacing-note')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
