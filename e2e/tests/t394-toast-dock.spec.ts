import { expect, test, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { KITCHEN, openNewProject, paste } from './wizard-helpers';

// T394 (CTO #14 M2): in the workspace views toasts dock at the canvas's bottom-right, clear of
// every canvas toolbar; a parts-view switch closes the paste undo toast. Checked with
// elementFromPoint: the arc options and the bench toolbar take the click right after a paste.
test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] } });

const pasteToast = (page: Page) =>
  page.locator('[data-sonner-toast]').filter({ hasText: tr.cutList.undo });

/** Every point a user would click on `el` (centre and the ends) hits `el` itself. */
async function clickable(el: Locator) {
  return el.evaluate((node) => {
    const r = node.getBoundingClientRect();
    const xs = [r.left + 4, r.left + r.width / 2, r.right - 4];
    return xs.every((x) => {
      const hit = document.elementFromPoint(x, r.top + r.height / 2);
      return hit !== null && node.contains(hit);
    });
  });
}

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error('no box');
  return b;
}

for (const [w, h] of [
  [1440, 900],
  [1024, 768],
] as const) {
  test(`${w}: after a paste the arc options take the click; a board toast docks bottom-right`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: w, height: h });
    await openNewProject(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    await expect(pasteToast(page)).toBeVisible();
    await page.getByTestId('parts-view-drawing').click();
    const canvas = page.getByTestId('editor-canvas');
    await expect(canvas).toHaveAttribute('data-view', /\d/);
    // The view switch closed the undo toast (undo stays on Ctrl+Z).
    await expect(pasteToast(page)).toHaveCount(0);
    await canvas.focus();
    await page.keyboard.press('a');
    const opts = page.getByTestId('arc-options');
    await expect(opts).toBeVisible();
    for (const b of await opts.getByRole('button').all()) expect(await clickable(b)).toBe(true);

    // A toast raised in the board (copy) sits at the canvas's bottom-right, off every toolbar.
    await page.keyboard.press('Escape');
    await canvas.focus();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+c');
    const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'kopyalandı' });
    await expect(toast).toBeVisible();
    await page.keyboard.press('a');
    await expect(opts).toBeVisible();
    await page.waitForTimeout(400); // toast enter transition
    for (const b of await opts.getByRole('button').all()) expect(await clickable(b)).toBe(true);
    const t = await box(toast);
    const c = await box(canvas);
    expect(t.x + t.width).toBeLessThanOrEqual(c.x + c.width + 1);
    expect(t.y + t.height).toBeLessThanOrEqual(c.y + c.height + 1);
    expect(t.y).toBeGreaterThan(c.y + c.height / 2);
    const inspector = page.getByTestId('editor-inspector');
    if (await inspector.isVisible()) {
      expect(t.x + t.width).toBeLessThanOrEqual((await box(inspector)).x + 1);
    }
  });

  test(`${w}: after a paste the bench toolbar takes the click`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: w, height: h });
    await openNewProject(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    await page.getByTestId('parts-view-assembly').click();
    await expect(page.getByTestId('bench')).toHaveAttribute('data-ready', 'true', {
      timeout: 30_000,
    });
    await expect(pasteToast(page)).toHaveCount(0);
    const bar = page.getByTestId('bench-toolbar');
    for (const b of await bar.getByRole('button').all()) {
      if (await b.isVisible()) expect(await clickable(b)).toBe(true);
    }
  });
}
