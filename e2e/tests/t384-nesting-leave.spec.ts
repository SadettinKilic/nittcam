import { expect, test } from '@playwright/test';
import { goStep, nest, paste, wizardReady } from './wizard-helpers';

/**
 * T384: leaving Dizilim while a nesting run is busy must not lose the result. The run lives in the
 * page's nesting host (not in the step), so Simülasyon / Dışa aktar show "Dizilim hesaplanıyor"
 * and update once the layout lands. No blind waits: only web-first assertions.
 */

/** Many copies so the run takes a moment (cold worker + placer). */
const BIG = [
  'Ad\tEn\tBoy\tAdet',
  'Yan\t560\t720\t60',
  'Raf\t564\t300\t80',
  'Kapak\t396\t716\t60',
].join('\n');

test.describe('T384 nesting survives leaving Dizilim', () => {
  test('mode click, then Simülasyon at once: the layout arrives', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/projeler/yeni/parcalar');
    await wizardReady(page, 'parcalar');
    await paste(page, BIG, 3);
    await nest(page);
    await goStep(page, 'simulasyon');
    // Either still busy (status) or already done; never the empty "no layout" panel for good.
    await expect(page.getByTestId('sim-canvas')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId('sim-empty')).toHaveCount(0);
    await expect(page.getByTestId('sim-nesting')).toHaveCount(0);
  });

  test('mode click, then Dışa aktar at once: waits for the layout, then checks', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/projeler/yeni/parcalar');
    await wizardReady(page, 'parcalar');
    await paste(page, BIG, 3);
    await nest(page);
    await goStep(page, 'export');
    await expect(page.getByTestId('export-nesting')).toHaveCount(0, { timeout: 120_000 });
    await expect(page.getByText(/Önce Dizilim adımında parçaları yerleştirin/)).toHaveCount(0);
  });
});
