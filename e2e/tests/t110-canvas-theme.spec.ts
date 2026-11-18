import { expect, test, type Page } from '@playwright/test';
import { goStep, openNewProject, pasteAndNest } from './wizard-helpers';

// T110: Konva canvases take their colours from the design tokens and follow a live theme switch
// (next-themes toggles the `dark` class on <html>) without a reload.

async function setDark(page: Page, dark: boolean) {
  await page.evaluate((on) => document.documentElement.classList.toggle('dark', on), dark);
}

async function token(page: Page, name: string): Promise<string> {
  return page.evaluate(
    (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
    name,
  );
}

test.describe('T110 canvas theme', () => {
  test('layout and simulation canvases switch colours with the theme', async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: 'light' });
    await openNewProject(page, 'parcalar');
    await pasteAndNest(page);

    const layout = page.getByTestId('layout-canvas');
    await setDark(page, false);
    const light = await token(page, '--color-part');
    await expect(layout).toHaveAttribute('data-part-color', light);
    await setDark(page, true);
    const dark = await token(page, '--color-part');
    expect(dark).not.toBe(light);
    await expect(layout).toHaveAttribute('data-part-color', dark);

    await goStep(page, 'simulasyon');
    const sim = page.getByTestId('sim-canvas');
    await expect(sim).toBeVisible({ timeout: 30_000 });
    const simDark = await token(page, '--color-sim-part');
    await expect(sim).toHaveAttribute('data-part-color', simDark);
    await setDark(page, false);
    await expect(sim).toHaveAttribute('data-part-color', await token(page, '--color-sim-part'));
    // The "air cut'ın yerine geçmez" banner stays visible in both themes.
    await expect(page.getByTestId('sim-banner')).toBeVisible();
  });
});
