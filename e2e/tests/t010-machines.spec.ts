import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };

const t = tr.machines;
const f = t.form.fields;

function row(page: Page, name: string) {
  return page.getByRole('row').filter({ has: page.getByRole('cell', { name, exact: false }) });
}

test.describe('T010 Makineler', () => {
  test('lists the seeded example, creates a profile and shows it as Taslak', async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (err) => problems.push(err.message));

    await page.goto('/makineler');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.title);
    await expect(page.getByRole('navigation', { name: tr.nav.label })).toBeVisible();
    await expect(page.getByRole('link', { name: tr.nav.machines })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // Seeded example profile (D-016).
    const seeded = row(page, 'Genel düz G-code router');
    await expect(seeded).toBeVisible();
    await expect(seeded.getByText(t.example)).toBeVisible();
    await expect(seeded.getByTestId('machine-state')).toHaveText(t.state.draft);
    await expect(seeded).toContainText('2.440 × 1.220 mm');

    // Create.
    const name = `E2E Router ${Date.now()}`;
    await page.getByRole('button', { name: t.add }).click();
    await expect(page.getByRole('heading', { name: t.form.createTitle })).toBeVisible();
    await page.getByLabel(f.name).fill(name);
    await page.getByLabel(f.controllerFamily).fill('Mach3');
    await page.getByRole('button', { name: t.form.save }).click();

    await expect(page.getByText(t.form.saved.replace('{version}', '1'))).toBeVisible();
    const created = row(page, name);
    await expect(created).toBeVisible();
    await expect(created.getByTestId('machine-state')).toHaveText(t.state.draft);
    await expect(created).toContainText('Mach3');
    await expect(created).toContainText('v1');

    await page.screenshot({ path: '__screenshots__/t010-makineler.png', fullPage: true });

    // Edit → new immutable version.
    await created.getByRole('button', { name: `${t.edit}: ${name}` }).click();
    await expect(page.getByRole('heading', { name: t.form.editTitle })).toBeVisible();
    await expect(page.getByLabel(f.name)).toHaveValue(name);
    await page.getByLabel(f.tableWidth).fill('2800');
    await page.getByRole('button', { name: t.form.save }).click();
    await expect(page.getByText(t.form.saved.replace('{version}', '2'))).toBeVisible();
    await expect(row(page, name)).toContainText('v2');
    await expect(row(page, name)).toContainText('2.800 × 1.220 mm');

    expect(problems).toEqual([]);
  });

  test('shows Turkish validation messages and does not save an invalid profile', async ({
    page,
  }) => {
    await page.goto('/makineler');
    await page.getByRole('button', { name: t.add }).click();
    // Name left empty; X travel is not a number; spoilboard allowance above 5 mm.
    await page.getByLabel(f.envelopeX).fill('abc');
    await page.getByLabel(f.spoilboard).fill('7,5');
    await page.getByRole('button', { name: t.form.save }).click();

    await expect(page.getByText(t.form.hasErrors)).toBeVisible();
    await expect(page.getByText(t.errors.required).first()).toBeVisible();
    await expect(page.getByText(t.errors.number)).toBeVisible();
    await expect(page.getByText(t.errors.max.replace('{max}', '5'))).toBeVisible();
    await expect(page.getByLabel(f.name)).toBeFocused();
    await expect(page.getByLabel(f.envelopeX)).toHaveAttribute('aria-invalid', 'true');
    await page.screenshot({ path: '__screenshots__/t010-makine-formu.png', fullPage: true });

    // Fixing the fields clears the messages; cancel returns to the list without saving.
    await page.getByLabel(f.envelopeX).fill('2500');
    await expect(page.getByText(t.errors.number)).toHaveCount(0);
    await page.getByRole('button', { name: t.form.cancel }).click();
    await expect(page.getByRole('button', { name: t.add })).toBeVisible();
  });
});
