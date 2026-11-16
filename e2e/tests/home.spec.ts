import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };

test('home page renders the Turkish title and text', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(tr.meta.title);
  await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tr.home.title);
  await expect(page.getByText(tr.home.subtitle)).toBeVisible();
});
