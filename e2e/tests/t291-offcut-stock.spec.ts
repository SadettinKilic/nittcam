import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { fill, watchConsole } from './wizard-helpers';

/** T291: offcut stock on Projeler → "Artık parçalar": add by hand, correct, delete + "Geri al". */
const t = tr.projects.offcuts;

test('add an offcut by hand, correct its size, delete and undo', async ({ page }) => {
  const problems = watchConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  // A size no other test uses, so the row is ours.
  const w = 700 + Math.floor(Math.random() * 200);
  const size = fill(t.size, { w, h: 413 });
  const edited = fill(t.size, { w, h: 397 });

  await page.goto('/projeler');
  await page.getByTestId('offcuts-tab').click();
  await page.getByTestId('offcut-add').click();
  const dialog = page.getByTestId('offcut-dialog');
  await expect(dialog).toBeVisible();
  // Empty sizes: the dialog says why and stays open.
  await dialog.getByTestId('offcut-form-save').click();
  await expect(dialog.getByTestId('offcut-form-message')).toHaveText(t.form.invalid);
  await dialog.getByTestId('offcut-form-width').fill(String(w));
  await dialog.getByTestId('offcut-form-height').fill('413');
  await dialog.getByTestId('offcut-form-save').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(fill(t.toast.added, { size }))).toBeVisible();
  const row = page.getByTestId('offcut-row').filter({ hasText: size });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(t.noSource);
  await expect(row).toContainText('0°');

  // Correct the length.
  await row.getByTestId('offcut-edit').click();
  await expect(dialog.getByTestId('offcut-form-width')).toHaveValue(String(w));
  await dialog.getByTestId('offcut-form-height').fill('397');
  await dialog.getByTestId('offcut-form-save').click();
  await expect(page.getByText(fill(t.toast.saved, { size: edited }))).toBeVisible();
  const editedRow = page.getByTestId('offcut-row').filter({ hasText: edited });
  await expect(editedRow).toHaveCount(1);
  await expect(page.getByTestId('offcut-row').filter({ hasText: size })).toHaveCount(0);

  // Delete, undo from the toast, delete again; a reload keeps it gone.
  await editedRow.getByTestId('offcut-delete').click();
  await expect(editedRow).toHaveCount(0);
  const toast = page
    .locator('[data-sonner-toast]')
    .filter({ hasText: fill(t.toast.deleted, { size: edited }) });
  await toast.getByRole('button', { name: t.undo }).click();
  await expect(page.getByText(fill(t.toast.restored, { size: edited }))).toBeVisible();
  await expect(editedRow).toHaveCount(1);
  await editedRow.getByTestId('offcut-delete').click();
  await expect(editedRow).toHaveCount(0);
  await page.reload();
  await page.getByTestId('offcuts-tab').click();
  await expect(page.getByTestId('offcut-add')).toBeEnabled();
  await expect(page.getByTestId('offcut-row').filter({ hasText: edited })).toHaveCount(0);
  expect(problems).toEqual([]);
});
