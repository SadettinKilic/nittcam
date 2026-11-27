import { expect, test } from '@playwright/test';
import { goStep, openNewProject, paste } from './wizard-helpers';

/**
 * T168: leftovers are proposed after nesting and saved only on confirm; they show in Projeler →
 * Artık parçalar; the next project of the same material nests on the offcut first.
 */

test('offcut proposals → stock → used first by the next nesting', async ({ page }) => {
  await openNewProject(page, 'parcalar');
  await paste(page, 'Ad\tEn\tBoy\tAdet\nYan\t600\t500\t2', 1);
  await goStep(page, 'dizilim');
  await expect(page.getByTestId('nesting-sheets')).toBeVisible({ timeout: 20_000 });
  const panel = page.getByTestId('offcut-proposals');
  await expect(panel).toBeVisible();
  // P4: nothing is pre-ticked; saving needs a tick, then a toast confirms it.
  await expect(page.getByTestId('offcut-proposal').first()).not.toBeChecked();
  await expect(page.getByTestId('offcut-save')).toBeDisabled();
  for (const box of await page.getByTestId('offcut-proposal').all()) await box.check();
  await page.getByTestId('offcut-save').click();
  await expect(page.getByTestId('offcut-saved')).toBeVisible();
  await expect(page.locator('[data-sonner-toast]').first()).toBeVisible();

  await page.goto('/projeler');
  await page.getByTestId('offcuts-tab').click();
  await expect(
    page.locator('[data-testid="offcut-row"][data-status="available"]').first(),
  ).toBeVisible();

  // A new project of the same material: "Önce artık parçaları kullan" → the offcut is used.
  await openNewProject(page, 'parcalar');
  await paste(page, 'Ad\tEn\tBoy\tAdet\nRaf\t300\t300\t1', 1);
  await goStep(page, 'dizilim');
  await expect(page.getByTestId('nesting-sheets')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('nesting-offcuts')).toHaveCount(0);
  await page.getByTestId('layout-use-offcuts').click();
  await expect(page.getByTestId('layout-offcut-count')).not.toHaveAttribute('data-count', '0');
  await page
    .locator(
      'button[data-testid^="layout-mode-"][aria-pressed="true"]:visible, [data-testid="layout-nest-compact"]:visible',
    )
    .click();
  await expect(page.getByTestId('nesting-offcuts')).toHaveAttribute('data-count', '1', {
    timeout: 20_000,
  });
  // The switch is one undo step.
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('layout-use-offcuts')).not.toBeChecked();
});
