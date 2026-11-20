import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { fill, openNewProject } from './wizard-helpers';

/**
 * B39 rider (tester finding): the shared `DialogContent` is never taller than the viewport and its
 * action row stays on screen, so the cabinet dialog's "N parça ekle" is reachable with the mouse on
 * short laptop screens and phones.
 */
const c = tr.cutList.cabinet;

for (const size of [
  { width: 1366, height: 768 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
]) {
  test(`cabinet dialog actions visible at ${size.width}×${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await openNewProject(page, 'parcalar');
    await page.getByTestId('cabinet-open').click();
    const dialog = page.getByTestId('cabinet-dialog');
    await expect(dialog).toBeVisible();

    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect((box?.y ?? -1) >= 0).toBe(true);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(size.height);

    // The add button is inside the viewport without scrolling the dialog (sticky footer).
    const add = page.getByTestId('cabinet-add');
    await expect(add).toHaveText(fill(c.add, { count: 6 }));
    await expect(add).toBeInViewport({ ratio: 1 });
    // A mouse click (not Enter) adds the cabinet.
    await add.click();
    await expect(dialog).toBeHidden();
  });
}
