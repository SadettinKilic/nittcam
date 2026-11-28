import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { openNewProject, pickOption } from './wizard-helpers';

// T396 (CTO #14 P1–P3): picking ACM takes an ACM sheet (undoable, notice), the thickness chips
// say which ones have a set, and "Örnek ACM ayarlarını ekle" opens the machine form with them.
const w = tr.wizard.machine;
const preset = (a: string, b: string) => w.preset.replace('{a}', a).replace('{b}', b);

test('ACM at step 1: ACM sheet with a notice and Ctrl+Z, honest chips, example sets in one click', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'makine');
  const select = page.getByTestId('wizard-material');
  const woodSheet = page.getByRole('radio', { checked: true });
  const woodLabel = await woodSheet.evaluate((e) => e.parentElement?.textContent ?? '');

  await pickOption(select, tr.materials.acm);
  // P2: the first ACM preset is pressed, and a notice says so.
  await expect(page.getByLabel(preset('1.250', '3.200'))).toBeChecked();
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: '1.250' })).toBeVisible();

  // P1: the chips are the material's thicknesses; none has a set on the seeded machine, and the
  // red box below agrees.
  await expect(page.getByText(w.kindThicknessHint)).toBeVisible();
  const chips = page.locator('button[data-has-set]');
  await expect(chips.first()).toBeVisible();
  for (const c of await chips.all()) await expect(c).toHaveAttribute('data-has-set', 'false');
  await expect(page.getByTestId('no-cutting-params')).toBeVisible();

  // P3: one click to the example sets.
  const examples = page.getByTestId('add-acm-examples');
  await expect(examples).toHaveText(w.addAcmExamples);
  await expect(examples).toHaveAttribute('href', /ornek=1/);

  // Undo: material and sheet go back together.
  await page.getByRole('heading', { level: 1 }).first().click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(select).not.toContainText(tr.materials.acm);
  await expect(page.getByRole('radio', { checked: true })).toHaveCount(1);
  expect(
    await page
      .getByRole('radio', { checked: true })
      .evaluate((e) => e.parentElement?.textContent ?? ''),
  ).toBe(woodLabel);

  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(select).toContainText(tr.materials.acm);
  await page.getByTestId('add-acm-examples').click();
  await expect(page).toHaveURL(/\/makineler\?.*ornek=1/);
  await expect(page.getByTestId('machine-form')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('machine-dirty')).toBeVisible();
  // Both example sets are in the form now, so its own button is gone.
  await expect(page.getByTestId('materials-add-acm')).toHaveCount(0);
});
