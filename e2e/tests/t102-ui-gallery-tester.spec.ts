import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };

// T101/T102 tester: NumberInput edge cases, keyboard-only overlays, theme persistence.
const t = tr.devUi;

test.describe('B1 tester: NumberInput edge cases', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dev/ui');
    await expect(page.getByRole('heading', { level: 1, name: t.title })).toBeVisible();
  });

  test('empty, negative, beyond min/max, decimal styles, paste', async ({ page }) => {
    const width = page.getByRole('spinbutton', { name: t.number.width });
    const value = page.getByTestId('width-value');

    await width.fill('1.220,5');
    await expect(value).toHaveText('1220.5');
    await width.fill('1220.5');
    await expect(value).toHaveText('1220.5');

    await width.fill('');
    await expect(width).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText(t.number.errorEmpty).first()).toBeVisible();

    await width.fill('-5');
    await expect(width).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText(t.number.errorMin)).toBeVisible();

    await width.fill('0');
    await expect(page.getByText(t.number.errorMin)).toBeVisible();

    await width.fill('2.441');
    await expect(page.getByText(t.number.errorMax)).toBeVisible();

    await width.fill('1,2,3');
    await expect(width).toHaveAttribute('aria-invalid', 'true');
    await width.fill('12 ,5');
    await expect(width).not.toHaveAttribute('aria-invalid', 'true');

    // Paste (clipboard text goes through the same onChange).
    await width.fill('');
    await width.focus();
    await page.evaluate(() => navigator.clipboard?.writeText?.('1.234,5').catch(() => {}));
    await page.keyboard.insertText('1.234,5');
    await expect(value).toHaveText('1234.5');
  });

  test('arrows clamp at the bounds and Shift steps by 10', async ({ page }) => {
    const width = page.getByRole('spinbutton', { name: t.number.width });
    const value = page.getByTestId('width-value');
    await width.fill('2.435');
    await width.press('Shift+ArrowUp');
    await expect(value).toHaveText('2440');
    await width.fill('5');
    await width.press('Shift+ArrowDown');
    await expect(value).toHaveText('1');
    await width.press('ArrowDown');
    await expect(value).toHaveText('1');
  });

  test('disabled NumberInput is not focusable', async ({ page }) => {
    const d = page.getByRole('spinbutton', { name: t.number.disabled });
    await expect(d).toBeDisabled();
  });
});

test.describe('B1 tester: keyboard-only overlays and theme', () => {
  test('every overlay opens with Enter and closes with Escape, focus returns', async ({ page }) => {
    await page.goto('/dev/ui');
    const o = t.overlays;
    for (const [name, role] of [
      [o.dialogTrigger, 'dialog'],
      [o.alertTrigger, 'alertdialog'],
      [o.sheetTrigger, 'dialog'],
      [o.menuTrigger, 'menu'],
      [o.popoverTrigger, 'dialog'],
    ] as const) {
      const trigger = page.getByRole('button', { name, exact: true });
      await trigger.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole(role)).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole(role)).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
  });

  test('menu: arrow keys move focus between items', async ({ page }) => {
    await page.goto('/dev/ui');
    await page.getByRole('button', { name: t.overlays.menuTrigger, exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();
    const active = () => page.evaluate(() => document.activeElement?.textContent ?? '');
    await expect.poll(active).toContain(t.overlays.menuDuplicate);
    await page.waitForTimeout(200); // let Radix finish its open-time focus handling
    // Arrow keys eventually move focus (Radix can drop a key pressed right after opening).
    await expect(async () => {
      await page.keyboard.press('ArrowDown');
      expect(await active()).not.toContain(t.overlays.menuDuplicate);
    }).toPass({ timeout: 5000 });
    await page.keyboard.press('End');
    await expect.poll(active).toContain(t.overlays.menuDelete);
  });

  test('dialog traps Tab focus', async ({ page }) => {
    await page.goto('/dev/ui');
    await page.getByRole('button', { name: t.overlays.dialogTrigger, exact: true }).click();
    const dialog = page.getByRole('dialog');
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
  });

  test('system theme follows prefers-color-scheme; explicit choice persists under key', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/dev/ui');
    await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    await page.getByRole('radio', { name: t.theme.light }).click();
    await expect(page.locator('html')).toHaveClass(/\blight\b/);
    expect(await page.evaluate(() => localStorage.getItem('nittcam-theme'))).toBe('light');
    await page.reload();
    await expect(page.locator('html')).toHaveClass(/\blight\b/);
  });

  test('a user can reach every interactive control with Tab alone and focus is visible', async ({
    page,
  }) => {
    await page.goto('/dev/ui');
    const seen = new Set<string>();
    const missing = new Set<string>();
    for (let i = 0; i < 120; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        const ring = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
        const textEntry =
          (el.tagName === 'INPUT' &&
            !['checkbox', 'radio'].includes((el as HTMLInputElement).type)) ||
          el.tagName === 'TEXTAREA';
        const halo = /rgba?\((?!0, 0, 0, 0\))[^)]*\)\s+0px 0px 0px [1-9]/.test(cs.boxShadow);
        return {
          tag: el.tagName,
          ok: textEntry ? halo || ring : ring,
          text: (el.textContent ?? '').slice(0, 20),
        };
      });
      if (info) {
        seen.add(info.tag);
        if (!info.ok) missing.add(`${info.tag} "${info.text}"`);
      }
    }
    expect([...missing], 'controls with no visible focus indicator').toEqual([]);
    expect(seen.size).toBeGreaterThan(2);
  });
});
