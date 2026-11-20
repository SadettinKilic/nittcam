import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { fill, goStep, openNewProject, pasteAndNest, saved } from './wizard-helpers';

// T293 (CTO #11 A, D-069): the Kesim ayarları fields refuse tab sizes that cannot hold a part and
// say the range; the project keeps its last valid value.

const c = tr.simulation.cutting;

test('T293: tab width / height / count outside the bounds are refused with the range', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page, 'Ad\tEn\tBoy\tAdet\nYan\t560\t720\t1\nTakoz\t80\t80\t2', 2);
  await saved(page);
  await goStep(page, 'simulasyon');
  const panel = page.getByTestId('sim-cutting');
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('sim-check-status')).toHaveAttribute('data-ok', 'true', {
    timeout: 30_000,
  });

  const width = page.getByTestId('sim-cutting-width');
  await width.fill('0,1');
  await width.press('Enter');
  await expect(panel.getByText(fill(c.bounds.width, { min: '3' }))).toBeVisible();
  await expect(page.getByTestId('sim-cutting-source')).not.toContainText(c.source.project);

  const height = page.getByTestId('sim-cutting-height');
  await height.fill('17,9');
  await height.press('Enter');
  await expect(panel.getByText(fill(c.bounds.height, { min: '1', max: '17' }))).toBeVisible();

  const count = page.getByTestId('sim-cutting-count');
  await count.fill('2,5');
  await count.press('Enter');
  await expect(panel.getByText(c.bounds.count)).toBeVisible();

  // The edges are accepted.
  await width.fill('3');
  await width.press('Enter');
  await expect(page.getByTestId('sim-cutting-source')).toContainText(c.source.project);
  await expect(page.getByTestId('sim-check-status')).toHaveAttribute('data-ok', 'true', {
    timeout: 30_000,
  });
});
