import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { goStep, openNewProject, pasteAndNest } from './wizard-helpers';

// T245: simulation transport and summary polish.
const s = tr.simulation;

test('Oynat is solid accent when idle, Duraklat secondary while playing; air-cut sentence visible; compact Özet', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page);
  await goStep(page, 'simulasyon');
  const canvas = page.getByTestId('sim-canvas');
  await expect(canvas).toBeVisible({ timeout: 30_000 });

  // Safety: the air-cut sentence is on screen without a click.
  await expect(page.getByTestId('sim-banner')).toContainText(s.banner);
  await expect(page.getByTestId('sim-banner')).toBeVisible();

  const play = page.getByTestId('sim-play');
  await expect(play).toHaveText(s.controls.play);
  await expect(play).toBeEnabled();
  await expect(play).toHaveClass(/\bbg-accent\b/);
  await play.click();
  await expect(play).toHaveText(s.controls.pause);
  await expect(play).toHaveClass(/\bbg-surface-hover\b/);
  await expect(canvas).toHaveAttribute('data-playing', 'true');
  await play.click();
  await expect(play).toHaveText(s.controls.play);
  await expect(canvas).toHaveAttribute('data-playing', 'false');

  // No reduced-motion note without reduced motion.
  await expect(page.getByTestId('sim-reduced-info')).toHaveCount(0);

  // Özet: six values as one compact definition list.
  const list = page.getByTestId('sim-summary-list');
  await expect(list.locator('dt')).toHaveCount(6);
  const box = await list.boundingBox();
  expect(box?.height ?? 999).toBeLessThanOrEqual(150);
});
