import { expect, test, type Page } from '@playwright/test';
import { KITCHEN, openNewProject, paste } from './wizard-helpers';

/** B39 / P4 (CTO #8–#10): toasts in the wizard stay off the panels and close on a step change. */

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function copyToast(page: Page) {
  await page.getByTestId('editor-canvas').focus();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+c');
  const toast = page.locator('[data-sonner-toast]').first();
  await expect(toast).toBeVisible();
  await page.waitForTimeout(500); // enter animation
  return toast;
}

for (const [w, h] of [
  [1440, 900],
  [1024, 768],
] as const) {
  test(`${w} × ${h}: a wizard toast covers neither the inspector, the canvas bottom nor the footer`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: w, height: h });
    await openNewProject(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    await page.getByTestId('parts-view-drawing').click();
    await expect(page.getByTestId('editor-canvas')).toHaveAttribute('data-view', /\d/);
    const toast = await copyToast(page);
    const tb = await toast.boundingBox();
    const canvas = await page.getByTestId('editor-canvas').boundingBox();
    const next = await page.getByTestId('wizard-next').boundingBox();
    const inspector = await page.getByTestId('editor-inspector').boundingBox();
    if (!tb || !canvas || !next) throw new Error('no box');
    if (inspector) expect(overlaps(tb, inspector)).toBe(false);
    // Scale bar / cursor read-out live in the canvas's bottom corners: the toast stays in the top half.
    expect(tb.y + tb.height).toBeLessThanOrEqual(canvas.y + canvas.height / 2);
    expect(overlaps(tb, next)).toBe(false);

    // A step change closes it.
    await page.getByTestId('wizard-next').click();
    await expect(page).toHaveURL(/adim=dizilim/);
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  });
}
