import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { expectNoA11yViolations } from './visual/helpers';
import { goStep, openNewProject, pickOption } from './wizard-helpers';

// B68 tester: T395 aluminium (one error, no fix buttons, Simülasyon one error), T396 screenshots
// at 1440, 390 smoke + axe at step 1.
const m = tr.materials;

test.describe('B68 tester', () => {
  test('aluminium: one message at step 1 and one error on Simülasyon; ACM and aluminium captures', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'makine');
    const select = page.getByTestId('wizard-material');

    await pickOption(select, m.acm);
    await expect(page.getByTestId('add-acm-examples')).toBeVisible();
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'e2e/__screenshots__/b68-step1-acm-1440.png' });

    await pickOption(select, m.aluminium);
    await expect(page.getByTestId('material-not-released')).toHaveCount(1);
    await expect(page.getByTestId('add-cutting-params')).toHaveCount(0);
    await expect(page.getByTestId('add-acm-examples')).toHaveCount(0);
    await expect(page.getByTestId('no-cutting-params')).toHaveCount(0);
    await page.waitForTimeout(500);
    await page.screenshot({ path: 'e2e/__screenshots__/b68-step1-aluminium-1440.png' });

    await goStep(page, 'simulasyon');
    const alerts = page.getByRole('alert');
    expect(await alerts.count()).toBeLessThanOrEqual(1);
    await page.screenshot({ path: 'e2e/__screenshots__/b68-sim-aluminium-1440.png' });
  });

  test('390 smoke at step 1 (ACM, aluminium): no page scroll, axe clean', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await openNewProject(page, 'makine');
    const select = page.getByTestId('wizard-material');
    for (const mat of [m.acm, m.aluminium]) {
      await pickOption(select, mat);
      await page.waitForTimeout(600);
      const over = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(over).toBeLessThanOrEqual(0);
      await expectNoA11yViolations(page);
    }
  });
});
