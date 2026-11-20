import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { fill, openNewProject, paste, saved, watchConsole } from './wizard-helpers';

/** T178 (delete part): soft delete on Projeler with a "Geri al" toast; hidden from Ana sayfa. */
const t = tr.projects;
const ROWS = ['Parça adı\tEn\tBoy\tAdet', 'Raf\t500\t300\t2'].join('\n');

test('delete a project, undo from the toast, delete again: hidden from Projeler and Ana sayfa', async ({
  page,
}) => {
  const problems = watchConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const name = `Silinecek ${Math.random().toString(36).slice(2, 8)}`;
  await openNewProject(page, 'parcalar');
  await paste(page, ROWS, 1);
  const nameField = page.getByTestId('project-name');
  await nameField.fill(name);
  await nameField.press('Enter');
  await saved(page);

  await page.goto('/projeler');
  await page.getByTestId('projects-search').fill(name);
  const row = page.getByTestId('project-row').filter({ hasText: name });
  await expect(row).toHaveCount(1);
  const del = page.getByRole('button', { name: fill(t.rowAction, { action: t.delete, name }) });

  // Delete: no confirm dialog, the row leaves, the toast offers "Geri al".
  await del.click();
  await expect(row).toHaveCount(0);
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: fill(t.deleted, { name }) });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: t.undo }).click();
  await expect(page.getByText(fill(t.restored, { name }))).toBeVisible();
  await expect(row).toHaveCount(1);

  // Delete again and reload: it stays hidden, on Ana sayfa too.
  await del.click();
  await expect(row).toHaveCount(0);
  await page.reload();
  await page.getByTestId('projects-search').fill(name);
  await expect(page.getByTestId('project-row').filter({ hasText: name })).toHaveCount(0);
  await page.goto('/');
  await expect(page.getByText(name)).toHaveCount(0);
  expect(problems).toEqual([]);
});
