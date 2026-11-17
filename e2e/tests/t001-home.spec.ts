import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };

test.describe('T001 home page', () => {
  test('renders Turkish copy, lang=tr, no console errors, and a screenshot', async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
    });
    page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));

    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'tr');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(tr.home.title);
    // The streamed page can briefly hold a hidden copy of the body (Suspense, T105/T106).
    await expect(page.getByText(tr.home.subtitle).filter({ visible: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: tr.home.recent })).toBeVisible();
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      'content',
      tr.meta.description,
    );

    await page.screenshot({ path: '__screenshots__/t001-home.png', fullPage: true });
    expect(problems).toEqual([]);
  });

  test('home page text keys all exist and are non-empty in tr.json', () => {
    for (const key of ['title', 'subtitle', 'recent'] as const) {
      expect(tr.home[key].trim().length).toBeGreaterThan(0);
    }
    expect(tr.meta.title.trim().length).toBeGreaterThan(0);
    expect(tr.meta.description.trim().length).toBeGreaterThan(0);
  });
});
