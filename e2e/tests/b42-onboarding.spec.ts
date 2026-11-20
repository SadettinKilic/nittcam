import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { expectNoA11yViolations } from './visual/helpers';

// T184: the tour's own spec starts with empty storage (the config marks the tour as seen).
test.use({ storageState: { cookies: [], origins: [] } });

const t = tr.onboarding;

test.describe('T184 first-run tour and sample project', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('opens once, runs by keyboard, is skippable and remembered', async ({ page }) => {
    await page.goto('/');
    const dialog = page.getByTestId('onboarding-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('data-page', 'welcome');
    await expect(page.getByTestId('onboarding-next')).toBeFocused();
    await expectNoA11yViolations(page);
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveAttribute('data-page', 'steps');
    await expect(page.getByTestId('onboarding-steps').getByRole('listitem')).toHaveCount(5);
    await expect(page.getByTestId('onboarding-progress')).toHaveText('Adım 2 / 3');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(dialog).toBeHidden();
  });

  test('reopens from Ayarlar', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('onboarding-skip').click();
    await page.goto('/ayarlar/malzemeler');
    await page.getByTestId('onboarding-reopen').click();
    await expect(page.getByTestId('onboarding-dialog')).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test('the sample project opens in the wizard with the cabinet and hinge doors', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByTestId('onboarding-next').click();
    await page.getByTestId('onboarding-next').click();
    await expect(page.getByTestId('onboarding-dialog')).toHaveAttribute('data-page', 'start');
    await page.getByTestId('onboarding-sample').click();
    await expect(page).toHaveURL(/\/projeler\/[0-9a-f-]{36}/);
    await expect(page.getByText(t.sampleName).filter({ visible: true }).first()).toBeVisible();
    // Sides 2, top, bottom, shelf, doors 2 (no back: one board, D-075).
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      tr.cutList.count.replace('{rows}', '5').replace('{pieces}', '7'),
    );
    await page.goto('/');
    await expect(page.getByTestId('onboarding-dialog')).toBeHidden();
  });
});
