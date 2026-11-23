import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { goStep, openNewProject, pasteAndNest, saved, toastsSettled } from './wizard-helpers';

// T308 (D-099): the cutting tool per operation in Simülasyon "Kesim ayarları". The picker lists
// only suitable tools of the machine (example machine: T2 Ø8 = the set's tool, T1 Ø6 also fits the
// outer contour), a choice is one command (Ctrl+Z undoes it), the spindle rows follow the chosen
// tool, "Önerilene dön" clears it.

const t = tr.simulation.cutting.tools;

async function axeClean(page: Page) {
  await toastsSettled(page);
  const res = await new AxeBuilder({ page }).include('[data-testid="sim-cutting"]').analyze();
  const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
}

test('T308: outer contour tool picker, spindle follows, undo and reset', async ({ page }) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page, 'Ad\tEn\tBoy\tAdet\nYan\t560\t720\t1', 1);
  await saved(page);
  await goStep(page, 'simulasyon');

  const check = page.getByTestId('sim-check-status');
  await expect(check).toHaveAttribute('data-ok', 'true', { timeout: 30_000 });
  const row = page.getByTestId('sim-tool-outer');
  await expect(row).toHaveAttribute('data-value', '2');
  await expect(row.getByTestId('sim-tool-outer-status')).toHaveText(t.source.recommended);
  // Only the outer contour row: no holes or inner cuts in this job.
  await expect(
    page.getByTestId('sim-cutting-tools').locator('[data-testid^="sim-tool-"][data-value]'),
  ).toHaveCount(1);
  await expect(page.getByTestId('sim-spindle-T2')).toBeVisible();

  // The list: the default first, then the other suitable tool (T1 Ø6); nothing else.
  const select = row.getByTestId('sim-tool-outer-select');
  await select.click();
  const options = page.getByRole('option');
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toContainText(t.recommendedSuffix);
  await expect(options.nth(1)).toContainText('T1 · Ø6 mm');
  await options.nth(1).click();
  await expect(row).toHaveAttribute('data-value', '1');
  await expect(row.getByTestId('sim-tool-outer-status')).toContainText(t.source.project);
  // The spindle rows follow the chosen tool.
  await expect(page.getByTestId('sim-spindle-T1')).toBeVisible();
  await expect(page.getByTestId('sim-spindle-T2')).toHaveCount(0);
  await expect(check).toHaveAttribute('data-ok', 'true', { timeout: 30_000 });
  await axeClean(page);

  // Undo (focus outside a field) goes back to the default.
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect(row).toHaveAttribute('data-value', '2');
  await expect(page.getByTestId('sim-spindle-T2')).toBeVisible();

  // Keyboard: open, pick T1, then "Önerilene dön".
  await select.focus();
  await page.keyboard.press('Enter');
  await expect(options).toHaveCount(2);
  await expect(options.nth(0)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(options.nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(row).toHaveAttribute('data-value', '1');
  await row.getByTestId('sim-tool-outer-reset').click();
  await expect(row).toHaveAttribute('data-value', '2');
  await expect(row.getByTestId('sim-tool-outer-reset')).toHaveCount(0);
});
