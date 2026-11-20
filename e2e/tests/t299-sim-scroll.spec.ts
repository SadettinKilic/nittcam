import { expect, test, type Page } from '@playwright/test';
import { goStep, openNewProject, pasteAndNest, saved } from './wizard-helpers';

// T299 (CTO #12 B): when the checks fail, the locked Simülasyon view scrolls inside the fixed
// workspace; "Kesim ayarlarına git" brings the card into view and never moves the footer over it.

const ROWS =
  'Ad\tEn\tBoy\tAdet\nYan\t560\t720\t1\nRaf\t540\t300\t2\nTakoz\t80\t80\t2\nArka\t400\t600\t1';

async function footerAtBottom(page: Page, height: number) {
  const box = await page.getByTestId('wizard-footer').boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs((box?.y ?? 0) + (box?.height ?? 0) - height)).toBeLessThan(2);
  return box?.y ?? 0;
}

for (const [width, height] of [
  [1440, 900],
  [1024, 768],
] as const) {
  test(`T299: locked Simülasyon scrolls and the cutting link keeps the footer (${width})`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    // Nest at 1440 (the 1024 layout folds the settings panel), then switch to the size under test.
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'parcalar');
    await pasteAndNest(page, ROWS, 4);
    await saved(page);
    await page.setViewportSize({ width, height });
    await goStep(page, 'simulasyon');
    await expect(page.getByTestId('sim-cutting')).toBeVisible({ timeout: 30_000 });

    // A tab wider than the parts: every part fails the checks (CTO's 1000 mm case).
    const tabWidth = page.getByTestId('sim-cutting-width');
    await tabWidth.fill('1000');
    await tabWidth.press('Enter');
    await expect
      .poll(() => page.getByTestId('violation').count(), { timeout: 30_000 })
      .toBeGreaterThanOrEqual(4);

    const scroller = page.getByTestId('sim-scroll');
    const dims = await scroller.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
    expect(dims.sh).toBeGreaterThan(dims.ch);
    const footerY = await footerAtBottom(page, height);

    // The mouse wheel scrolls the step content.
    await scroller.hover();
    await page.mouse.wheel(0, 400);
    await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await scroller.evaluate((el) => el.scrollTo(0, 0));

    // The link: card in view, footer stays at the bottom and does not cover the field.
    await page.getByTestId('violation-open-cutting').first().click();
    await footerAtBottom(page, height);
    const field = await tabWidth.boundingBox();
    expect(field).not.toBeNull();
    expect((field?.y ?? 0) + (field?.height ?? 0)).toBeLessThanOrEqual(footerY);
    expect(field?.y ?? 0).toBeGreaterThanOrEqual(0);
    expect(await page.evaluate(() => document.querySelector('main')?.scrollTop ?? 0)).toBe(0);

    // Back up to the list, then fix the value: the view returns to normal.
    await scroller.evaluate((el) => el.scrollTo(0, 0));
    await expect(page.getByTestId('violation').first()).toBeInViewport();
    await tabWidth.click();
    await tabWidth.fill('10');
    await tabWidth.press('Enter');
    await expect(page.getByTestId('sim-check-status')).toHaveAttribute('data-ok', 'true', {
      timeout: 30_000,
    });
  });
}
