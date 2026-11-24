import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { goStep, openThinSkinProject, pasteAndNest, saved } from './wizard-helpers';

/**
 * B62 tester (T331, D-123): on the Mach3 example machine (Ø8), a sheet margin below the tool Ø
 * (here 6: above the radius, below the diameter) must never reach a downloadable file: the
 * outside contour's cutter then runs 2 mm past the sheet edge at full depth.
 * D-129: with tabs the effective margin is Ø + 3, so the stored 6 cannot reach the cut; the case
 * stays reachable with thin skin, where the stored margin counts. The test runs there.
 */

async function commit(page: Page, testId: string, value: string) {
  const f = page.getByTestId(testId);
  await f.fill(value);
  await f.press('Enter');
}

test('margin 6 with Ø8 on the Mach3 example: export is blocked', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openThinSkinProject(page);
  await pasteAndNest(page, 'Ad\tEn\tBoy\tAdet\nYan\t560\t720\t1\nRaf\t540\t300\t2', 2);
  await saved(page);
  await commit(page, 'layout-margin', '6');
  await expect(page.getByTestId('layout-margin-warning')).toBeVisible();
  await page.getByRole('button', { name: tr.layout.renest, exact: true }).first().click();
  await saved(page);
  await goStep(page, 'export');
  const status = page.getByTestId('export-status');
  await expect(status).toBeVisible({ timeout: 60_000 });
  const ok = await status.getAttribute('data-ok');
  const violations = await page
    .getByTestId('export-violations')
    .innerText()
    .catch(() => '');
  console.log(`[b62-margin6] export-status data-ok=${ok}; violations=${violations.slice(0, 300)}`);
  expect(ok).toBe('false');
});
