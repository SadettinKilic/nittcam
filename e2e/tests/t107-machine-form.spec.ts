import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };

// T107: machine list (TanStack table / cards), sectioned form with side index, sticky save bar,
// dirty state + leave guard, corner picker.
const t = tr.machines;
const f = t.form.fields;

function row(page: Page, name: string) {
  return page.getByRole('row').filter({ has: page.getByRole('cell', { name, exact: false }) });
}

async function openNew(page: Page) {
  await page.goto('/makineler');
  await page.getByRole('button', { name: t.add }).click();
  await expect(page.getByRole('heading', { name: t.form.createTitle })).toBeVisible();
}

test.describe('T107 machine form', () => {
  test('save bar shows the dirty state; Vazgeç with changes asks first', async ({ page }) => {
    await openNew(page);
    const bar = page.getByTestId('machine-save-bar');
    await expect(bar).toContainText(t.form.status.clean);
    await page.getByLabel(f.name).fill('Kirli form');
    await expect(bar).toContainText(t.form.status.dirty);
    // Undoing the change makes the form clean again.
    await page.getByLabel(f.name).fill('');
    await expect(bar).toContainText(t.form.status.clean);
    await page.getByLabel(f.name).fill('Kirli form');

    await page.getByRole('button', { name: t.form.cancel }).click();
    const dialog = page.getByTestId('machine-leave-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: t.form.leave.stay }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByLabel(f.name)).toHaveValue('Kirli form');

    await page.getByRole('button', { name: t.form.cancel }).click();
    await page.getByRole('button', { name: t.form.leave.discard }).click();
    await expect(page.getByTestId('machine-list')).toBeVisible();
  });

  test('a clean form leaves without asking', async ({ page }) => {
    await openNew(page);
    await page.getByRole('button', { name: t.form.cancel }).click();
    await expect(page.getByTestId('machine-leave-dialog')).toHaveCount(0);
    await expect(page.getByTestId('machine-list')).toBeVisible();
  });

  test('leave guard: an in-app link with unsaved changes asks, discard navigates', async ({
    page,
  }) => {
    await openNew(page);
    await page.getByLabel(f.tableWidth).fill('2500');
    await page.getByTestId('shell-sidebar').getByRole('link', { name: tr.nav.projects }).click();
    await expect(page.getByTestId('machine-leave-dialog')).toBeVisible();
    await expect(page).toHaveURL(/\/makineler$/);
    await page.getByRole('button', { name: t.form.leave.discard }).click();
    await expect(page).toHaveURL(/\/projeler$/);
  });

  test('corner picker, NumberInput units and side index; version increments on save', async ({
    page,
  }) => {
    const name = `T107 köşe ${Date.now()}`;
    await openNew(page);
    await expect(page.getByRole('navigation', { name: t.form.sectionsIndex })).toBeVisible();
    await page
      .getByRole('navigation', { name: t.form.sectionsIndex })
      .getByRole('link', {
        name: t.form.sections.origin,
      })
      .click();
    await expect(page.getByRole('heading', { name: t.form.sections.origin })).toBeInViewport();

    await page.getByLabel(f.name).fill(name);
    await page.getByLabel(f.controllerFamily).fill('Mach3');
    const corners = page.getByRole('radiogroup', { name: f.corner });
    await corners.getByRole('radio', { name: t.form.options.corner.backRight }).click();
    await expect(
      corners.getByRole('radio', { name: t.form.options.corner.backRight }),
    ).toBeChecked();
    // Turkish number formatting with the unit inside the field.
    await page.getByLabel(f.tableWidth).fill('2440,5');
    await page.getByLabel(f.tableWidth).blur();
    await expect(page.getByLabel(f.tableWidth)).toHaveValue('2.440,5');
    await page.getByRole('button', { name: t.form.save }).click();
    await expect(page.getByText(t.form.saved.replace('{version}', '1'))).toBeVisible();
    await expect(row(page, name)).toContainText('v1');

    await row(page, name)
      .getByRole('button', { name: `${t.edit}: ${name}` })
      .click();
    await expect(
      page.getByText(t.form.versionBadge.replace('{version}', '1'), { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('radio', { name: t.form.options.corner.backRight })).toBeChecked();
    await page.getByRole('radio', { name: t.form.options.corner.frontLeft }).click();
    await page.getByRole('button', { name: t.form.save }).click();
    await expect(page.getByText(t.form.saved.replace('{version}', '2'))).toBeVisible();
    await expect(row(page, name)).toContainText('v2');
  });

  test('phones get the card list with the same actions', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/makineler');
    const list = page.getByTestId('machine-list');
    await expect(list).toBeVisible();
    await expect(page.getByRole('table')).toBeHidden();
    await expect(
      list.getByRole('button', { name: new RegExp(`^${t.edit}:`) }).first(),
    ).toBeVisible();
    await expect(
      list.getByRole('link', { name: new RegExp(`^${t.verify}:`) }).first(),
    ).toBeVisible();
  });

  test('leave guard: Back asks; Kal stays, Çık goes back past the form (B3 follow-up)', async ({
    page,
  }) => {
    await page.goto('/projeler');
    await page.goto('/makineler');
    await page.getByRole('button', { name: t.add }).click();
    await page.getByLabel(f.name).fill('Geri testi');
    await page.goBack();
    const dialog = page.getByTestId('machine-leave-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: t.form.leave.stay }).click();
    await expect(page).toHaveURL(/\/makineler/);
    await expect(page.getByLabel(f.name)).toHaveValue('Geri testi');
    await page.goBack();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: t.form.leave.discard }).click();
    await expect(page).toHaveURL(/\/projeler$/);
  });
});
