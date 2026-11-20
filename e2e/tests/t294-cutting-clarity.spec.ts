import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { fill, goStep, openNewProject, pasteAndNest, saved } from './wizard-helpers';

// T294 (CTO #11 E1): no hidden thin skin after "Kapalı → Her parçada", per-part count wording,
// the small-part minimum, a one-line summary in Özet that leads to the panel, a direction hint.

const c = tr.simulation.cutting;

test('T294: cutting settings show the skin they keep, the real counts and a summary line', async ({
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

  // Özet: one line with the settings, visible without scrolling the page; it leads to the panel.
  const line = page.getByTestId('sim-summary-cutting');
  await expect(line).toContainText('Köprü: her parçada 4 × 10 × 3 mm');
  await expect(line).toBeInViewport();
  await page.getByTestId('sim-summary-cutting-edit').click();
  await expect(panel.getByLabel(c.tabModes.all)).toBeFocused();

  await expect(panel.getByText(c.count, { exact: true })).toBeVisible();
  await expect(page.getByTestId('sim-cutting-direction-hint')).toHaveText(c.directionHint);

  // Count 1: small parts still get 2, the panel says so.
  const count = page.getByTestId('sim-cutting-count');
  await count.fill('1');
  await count.press('Enter');
  await expect(page.getByTestId('sim-cutting-small-count')).toHaveText(
    fill(c.smallCount, { n: 2 }),
  );

  // Kapalı → Her parçada: the thin skin stays and is shown, with a way to switch it off.
  await panel.getByLabel(c.tabModes.off).check();
  await panel.getByLabel(c.tabModes.all).check();
  await expect(page.getByTestId('sim-cutting-skin-on')).toContainText(
    fill(c.skinOn, { skin: '0,5' }),
  );
  const axe = await new AxeBuilder({ page }).include('[data-testid="sim-cutting"]').analyze();
  expect(axe.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))).toEqual(
    [],
  );
  await page.getByTestId('sim-cutting-skin-off').click();
  await expect(page.getByTestId('sim-cutting-skin-on')).toHaveCount(0);

  // A bridge higher than half the thickness is hard to break: a warning line.
  const height = page.getByTestId('sim-cutting-height');
  await height.fill('10');
  await height.press('Enter');
  await expect(page.getByTestId('sim-cutting-height-warn')).toHaveText(c.heightWarn);
});
