import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };

test('home page renders the Turkish title and text', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(`${tr.nav.home} · ${tr.meta.title}`);
  await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(tr.home.title);
  // The streamed page can briefly hold a hidden copy of the body (Suspense, T105/T106).
  await expect(page.getByText(tr.home.subtitle).filter({ visible: true })).toBeVisible();
});
