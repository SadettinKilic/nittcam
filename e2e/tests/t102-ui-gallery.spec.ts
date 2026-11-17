import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };

// T101/T102: keyboard behaviour of the primitives on the /dev/ui gallery.
const t = tr.devUi;

test.describe('T102 /dev/ui gallery', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/ui');
    await expect(page.getByRole('heading', { level: 1, name: t.title })).toBeVisible();
  });

  test('NumberInput: Turkish input, arrows, bounds, invalid state', async ({ page }) => {
    const width = page.getByRole('spinbutton', { name: t.number.width });
    const value = page.getByTestId('width-value');
    await expect(width).toHaveValue('1.220,5');

    await width.fill('1.200,5');
    await expect(value).toHaveText('1200.5');
    await width.press('ArrowUp');
    await expect(width).toHaveValue('1.201,5');
    await width.press('Shift+ArrowDown');
    await expect(value).toHaveText('1191.5');

    await width.fill('12,5');
    await expect(value).toHaveText('12.5');
    await width.blur();
    await expect(width).toHaveValue('12,5');

    await width.fill('abc');
    await expect(width).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText(t.number.errorInvalid).first()).toBeVisible();
    await expect(value).toHaveText('12.5');

    await width.fill('3.000');
    await expect(page.getByText(t.number.errorMax)).toBeVisible();
    await width.fill('2.440');
    await expect(width).not.toHaveAttribute('aria-invalid', 'true');
    await width.press('ArrowUp');
    await expect(value).toHaveText('2440');
  });

  test('keyboard: focus is visible and overlays open/close without a mouse', async ({ page }) => {
    const trigger = page.getByRole('button', { name: t.overlays.dialogTrigger, exact: true });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // Focus moved into the dialog and is trapped there.
    await expect(dialog.locator(':focus')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();

    // Visible focus ring: a non-zero outline on keyboard focus.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    const outline = await trigger.evaluate((el) => getComputedStyle(el).outlineWidth);
    expect(outline).not.toBe('0px');

    // Menu with arrows.
    await page.getByRole('button', { name: t.overlays.menuTrigger }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(
      page.getByRole('menuitem', { name: new RegExp(t.overlays.menuRename) }),
    ).toBeFocused();
    await page.keyboard.press('Escape');

    // Switch and checkbox with Space.
    const sw = page.getByRole('switch').nth(1);
    await sw.focus();
    await page.keyboard.press('Space');
    await expect(sw).toHaveAttribute('aria-checked', 'true');
  });
});
