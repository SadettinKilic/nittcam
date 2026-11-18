import { expect, test, type Locator, type Page } from '@playwright/test';
import { goStep, openNewProject, pasteAndNest } from './wizard-helpers';

/**
 * T198 tester: on a touch phone a one-finger drag that starts ON the canvas scrolls the page while
 * the view is at the fit, and pans the view (page stays put) once the user zoomed in. Covers the
 * layout canvas (Dizilim) and the simulation canvas.
 */
test.describe('T198 tester: one-finger touch on the canvas', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  async function swipeUp(page: Page, x: number, y: number, dist: number) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 10; i += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y - (dist * i) / 10 }],
      });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  }

  const scrollY = (page: Page) => page.evaluate(() => window.scrollY);
  const view = async (canvas: Locator) =>
    `${await canvas.getAttribute('data-x')},${await canvas.getAttribute('data-y')}`;

  async function check(page: Page, canvas: Locator, zoomInName: string) {
    // The page must have something to scroll for the test to mean anything.
    const room = await page.evaluate(
      () => document.documentElement.scrollHeight - window.innerHeight,
    );
    // Canvas-first workspace: the page below the canvas is short (sheet bar, footer), not zero.
    expect(room, 'page has vertical scroll room below the canvas').toBeGreaterThan(10);

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => scrollY(page)).toBe(0);
    let box = await canvas.boundingBox();
    if (!box) throw new Error('canvas has no box');
    const v0 = await view(canvas);
    await swipeUp(page, box.x + box.width / 2, box.y + box.height * 0.7, 160);
    // At the fit: the page scrolls, the view is not panned.
    await expect.poll(() => scrollY(page)).toBeGreaterThanOrEqual(Math.min(30, room - 2));
    expect(await view(canvas)).toBe(v0);

    // Zoomed in: the same gesture pans the view and leaves the page where it is.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => scrollY(page)).toBe(0);
    const s0 = Number(await canvas.getAttribute('data-scale'));
    await page.getByRole('button', { name: zoomInName }).filter({ visible: true }).first().click();
    await expect
      .poll(async () => Number(await canvas.getAttribute('data-scale')))
      .toBeGreaterThan(s0);
    box = await canvas.boundingBox();
    if (!box) throw new Error('canvas has no box');
    const v1 = await view(canvas);
    // Start the drag off the sheet (parts are draggable for manual moves): a stage spot outside both
    // possible sheet bands, where the topmost element is still the Konva canvas (no overlay).
    const spot = await page.evaluate(
      (tid) => {
        const host = document.querySelector(`[data-testid=${tid}]`);
        if (!host) return null;
        const r = host.getBoundingClientRect();
        const s = Number(host.getAttribute('data-scale'));
        const y0 = Number(host.getAttribute('data-y'));
        const h = Number(host.getAttribute('data-sheet-height')) * s;
        const x = r.left + r.width / 2;
        for (let y = r.height - 8; y > r.height * 0.4; y -= 4) {
          const onSheet = (y > y0 - 6 && y < y0 + h + 6) || (y > y0 - h - 6 && y < y0 + 6);
          if (onSheet) continue;
          const el = document.elementFromPoint(x, r.top + y);
          if (el?.tagName === 'CANVAS' && host.contains(el)) return { x, y: r.top + y };
        }
        return null;
      },
      await canvas.getAttribute('data-testid'),
    );
    expect(spot, 'an off-sheet spot on the zoomed canvas').not.toBeNull();
    const start = spot ?? { x: 0, y: 0 };
    await swipeUp(page, start.x, start.y, Math.min(120, start.y - box.y - 5));
    await expect.poll(() => view(canvas)).not.toBe(v1);
    expect(await scrollY(page)).toBeLessThanOrEqual(2);
  }

  test('layout canvas: drag scrolls the page at the fit, pans when zoomed', async ({ page }) => {
    await openNewProject(page, 'parcalar');
    await pasteAndNest(page);
    const canvas = page.getByTestId('layout-canvas');
    await expect(canvas).toHaveAttribute('data-scale', /\d/);
    await check(page, canvas, 'Yakınlaştır');
  });

  test('simulation canvas: drag scrolls the page at the fit, pans when zoomed', async ({
    page,
  }) => {
    await openNewProject(page, 'parcalar');
    await pasteAndNest(page);
    await goStep(page, 'simulasyon');
    const canvas = page.getByTestId('sim-canvas');
    await expect(canvas).toHaveAttribute('data-scale', /\d/, { timeout: 30_000 });
    await check(page, canvas, 'Yakınlaştır');
  });
});
