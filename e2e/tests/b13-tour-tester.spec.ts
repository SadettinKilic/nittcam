import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { KITCHEN, openNewProject, paste, toastsSettled, watchConsole } from './wizard-helpers';

/**
 * Tester B13 (T136): the first-use tour with a real first visit (empty storage). The config marks
 * the tour as seen for every other spec, so this file checks that an open tour does not break the
 * board: mouse drawing still works, axe is clean, no page scroll at 390 px, both themes captured.
 */
test.use({ storageState: { cookies: [], origins: [] } });

async function openBoard(page: Page, width: number) {
  await page.setViewportSize({ width, height: width > 600 ? 900 : 844 });
  await openNewProject(page, 'parcalar');
  await paste(page, KITCHEN, 5);
  await page.getByTestId('parts-view-drawing').click();
  await expect(page.getByTestId('editor-canvas')).toHaveAttribute('data-view', /\d/);
  await expect(page.getByTestId('editor-tour')).toBeVisible();
}

async function seriousAxe(page: Page) {
  // A toast still fading in or out is measured at part opacity (false contrast failures).
  await toastsSettled(page);
  const res = await new AxeBuilder({ page }).analyze();
  return res.violations
    .filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`);
}

test.describe('B13 tester: tour on a first visit', () => {
  test('open tour does not block mouse drawing; it stays put until skipped', async ({ page }) => {
    const problems = watchConsole(page);
    await openBoard(page, 1440);
    const canvas = page.getByTestId('editor-canvas');
    const before = await page.getByTestId('editor-part-list').getByRole('button').count();
    await page.getByTestId('editor-tool-rect').click();
    const b = await canvas.boundingBox();
    if (!b) throw new Error('no canvas');
    // Top-left area of the canvas, away from the tour card at the bottom.
    await page.mouse.click(b.x + b.width * 0.2, b.y + b.height * 0.2);
    await page.mouse.click(b.x + b.width * 0.35, b.y + b.height * 0.4);
    await expect(page.getByTestId('editor-part-list').getByRole('button')).toHaveCount(before + 1);
    // Still there (the user did not skip), and still remembered as not done.
    await expect(page.getByTestId('editor-tour')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('nittcam-editor-tour'))).toBeNull();
    await page.getByTestId('editor-tour-skip').click();
    await expect(page.getByTestId('editor-tour')).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('storage blocked: no tour, board works', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new Error('blocked');
        },
      });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    await page.getByTestId('parts-view-drawing').click();
    await expect(page.getByTestId('editor-canvas')).toHaveAttribute('data-view', /\d/);
    await page.waitForTimeout(500);
    await expect(page.getByTestId('editor-tour')).toHaveCount(0);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`1440 ${scheme}: every step axe clean, screenshot`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openBoard(page, 1440);
      for (const step of ['tools', 'draw', 'edit', 'status', 'help']) {
        await expect(page.getByTestId('editor-tour')).toHaveAttribute('data-step', step);
        expect(await seriousAxe(page)).toEqual([]);
        await page.screenshot({ path: `__screenshots__/b13-tour-${step}-1440-${scheme}.png` });
        await page.keyboard.press('ArrowRight');
      }
    });
  }

  test('390 smoke: card inside the screen, no page scroll, axe clean', async ({ page }) => {
    await openBoard(page, 390);
    const card = await page.getByTestId('editor-tour').boundingBox();
    expect(card && card.x >= 0 && card.x + card.width <= 390).toBe(true);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(await seriousAxe(page)).toEqual([]);
    await page.screenshot({ path: '__screenshots__/b13-tour-390-light.png' });
    await page.getByTestId('editor-tour-next').click();
    await page.getByTestId('editor-tour-skip').click();
    await expect(page.getByTestId('editor-tour')).toHaveCount(0);
  });
});
