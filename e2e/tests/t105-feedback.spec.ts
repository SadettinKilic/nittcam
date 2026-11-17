import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };

// T105: toasts, empty/error states, 404 and loading states.
const item = {
  id: 'p-1',
  name: 'Mutfak dolabı',
  status: 'draft',
  revision: 1,
  updatedAt: '2026-11-17T10:00:00Z',
  machine: 'Örnek router',
  material: 'mdf',
  thickness: 18,
  sheet: { width: 2800, height: 2070 },
  pieces: 4,
  lastExport: null,
};

test.describe('feedback states', () => {
  test('API error on Projeler → ErrorState → retry recovers', async ({ page }) => {
    let fail = true;
    await page.route('**/api/projects', (route) =>
      fail ? route.fulfill({ status: 500, json: { error: 'boom' } }) : route.fulfill({ json: [] }),
    );
    await page.goto('/projeler');
    const error = page.getByTestId('projects-error');
    await expect(error).toBeVisible();
    await expect(error).toHaveAttribute('role', 'alert');
    await expect(error).toContainText(tr.projects.error);
    fail = false;
    await error.getByRole('button', { name: tr.projects.retry }).click();
    await expect(page.getByTestId('projects-empty')).toBeVisible();
  });

  test('empty project list shows the EmptyState with the next step', async ({ page }) => {
    await page.route('**/api/projects', (route) => route.fulfill({ json: [] }));
    await page.goto('/projeler');
    const empty = page.getByTestId('projects-empty');
    await expect(empty).toContainText(tr.projects.empty);
    await expect(empty).toContainText(tr.projects.emptyText);
    await empty.getByRole('link', { name: tr.projects.emptyAction }).click();
    await expect(page).toHaveURL(/\/projeler\/yeni/);
  });

  test('a failed copy is an error toast; toasts are announced', async ({ page }) => {
    await page.route('**/api/projects', (route) => route.fulfill({ json: [item] }));
    await page.route('**/api/projects/p-1/copy', (route) =>
      route.fulfill({ status: 500, json: { error: 'boom' } }),
    );
    await page.goto('/projeler');
    const row = page.getByTestId('project-row').filter({ hasText: item.name });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: new RegExp(tr.projects.copy) }).click();
    const toast = page.locator('[data-sonner-toast]').filter({ hasText: tr.projects.copyFailed });
    await expect(toast).toBeVisible();
    await expect(toast).toHaveAttribute('data-type', 'error');
  });

  test('unknown URL → Turkish 404 inside the shell', async ({ page }) => {
    const res = await page.goto('/boyle-bir-sayfa-yok');
    expect(res?.status()).toBe(404);
    await expect(page.getByTestId('shell-topbar')).toBeVisible();
    await expect(page.getByTestId('shell-title')).toHaveText(tr.shell.crumbs.notFound);
    const box = page.getByTestId('not-found');
    await expect(box).toContainText(tr.feedback.notFound.title);
    await box.getByRole('link', { name: tr.feedback.notFound.projects }).click();
    await expect(page).toHaveURL(/\/projeler$/);
  });

  test('wizard load error is an ErrorState with retry and a way back', async ({ page }) => {
    await page.route('**/api/machines', (route) => route.fulfill({ status: 500, json: {} }));
    await page.goto('/projeler/yeni');
    const error = page.getByTestId('wizard-error');
    await expect(error).toBeVisible({ timeout: 30_000 });
    await expect(error).toContainText(tr.wizard.loadError);
    await expect(error.getByRole('button', { name: tr.wizard.retry })).toBeVisible();
    await expect(error.getByRole('link', { name: tr.wizard.backToList })).toBeVisible();
  });
});
