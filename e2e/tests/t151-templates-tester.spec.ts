import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// T151 tester: /sablonlar axe clean at 1440 and 1024, 390 smoke (no page-level horizontal scroll).
for (const [w, h] of [
  [1440, 900],
  [1024, 768],
  [390, 844],
] as const) {
  test(`Şablonlar ${w}px: axe clean, no horizontal scroll`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/sablonlar');
    await expect(page.getByTestId('template-card').first()).toBeVisible();
    const noScroll = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    );
    expect(noScroll).toBe(true);
    const res = await new AxeBuilder({ page }).analyze();
    expect(
      res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'),
    ).toEqual([]);
  });
}
