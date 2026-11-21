import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };

// B49 tester: T192 every help topic anchor opens its topic; help and field-test kit pages with
// axe at 1440 light/dark (+ the Yenilikler dialog in dark) and a 390 smoke without page scroll.
const SHOTS = '__screenshots__/b49-tester';

async function serious(page: Page) {
  await page.waitForTimeout(400);
  const res = await new AxeBuilder({ page }).analyze();
  return res.violations
    .filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))
    .map((v) => `${v.id}: ${v.nodes.length}`);
}

async function noScroll(page: Page) {
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(sw).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
}

test('T192: every topic anchor shows its topic', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const [id, topic] of Object.entries(tr.help.topics)) {
    await page.goto(`/yardim#${id}`);
    const el = page.locator(`[id="${id}"]`);
    await expect(el).toBeVisible();
    await expect(el).toContainText(topic.title);
    await expect(el).toBeInViewport();
  }
});

for (const scheme of ['light', 'dark'] as const) {
  test(`B49: help, Yenilikler and field-test kit at 1440 ${scheme}`, async ({ page, request }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/yardim');
    await expect(page.getByTestId('help-page')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/help-${scheme}.png`, fullPage: true });
    expect(await serious(page)).toEqual([]);
    await page.getByTestId('help-whats-new').click();
    await expect(page.getByTestId('whats-new-dialog')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/whats-new-${scheme}.png` });
    expect(await serious(page)).toEqual([]);
    await page.keyboard.press('Escape');

    const list = (await (await request.get('/api/machines')).json()) as { id: string }[];
    await page.goto(`/makineler/${list[0]?.id}/saha-kiti`);
    await expect(page.locator('main')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `${SHOTS}/field-kit-${scheme}.png`, fullPage: true });
    expect(await serious(page)).toEqual([]);
  });
}

test('B49: 390 smoke on help and the field-test kit', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/yardim');
  await expect(page.getByTestId('help-page')).toBeVisible();
  await noScroll(page);
  expect(await serious(page)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/help-390.png` });
  const list = (await (await request.get('/api/machines')).json()) as { id: string }[];
  await page.goto(`/makineler/${list[0]?.id}/saha-kiti`);
  await page.waitForLoadState('networkidle');
  await noScroll(page);
  expect(await serious(page)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}/field-kit-390.png` });
});
