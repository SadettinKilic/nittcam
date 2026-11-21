import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { goStep, openNewProject, pasteAndNest, saved, toastsSettled } from './wizard-helpers';

// B54 tester edge cases (T307 / T308): the slider keeps focus across Home / End / PageUp /
// PageDown while the run recomputes (the panel never drops to the loading view), the check badge
// says "pending" with aria-busy only while the shown run is stale, a typed value outside the
// machine range is not stored, and every layout is axe clean at 1440 and 390, light and dark.

async function freshRun(page: Page) {
  const check = page.getByTestId('sim-check-status');
  await expect(check).not.toHaveAttribute('data-ok', 'pending', { timeout: 30_000 });
  await expect(page.getByTestId('sim-summary')).not.toHaveAttribute('aria-busy', 'true');
}

async function setup(page: Page, width = 1440) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width, height: 900 });
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page, 'Ad\tEn\tBoy\tAdet\nYan\t560\t720\t1', 1);
  await saved(page);
  await goStep(page, 'simulasyon');
  await expect(page.getByTestId('sim-cutting-spindle')).toBeVisible({ timeout: 30_000 });
  await freshRun(page);
}

test('B54 tester: slider keeps focus across Home/End/PageUp/PageDown recomputes', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await setup(page);
  const row = page.locator('[data-testid^="sim-spindle-T"][data-value]').first();
  const thumb = row.getByRole('slider');
  const min = Number(await thumb.getAttribute('aria-valuemin'));
  const max = Number(await thumb.getAttribute('aria-valuemax'));
  await thumb.focus();
  let seenBusy = false;
  for (const [key, want] of [
    ['Home', min],
    ['PageUp', min + 1000],
    ['End', max],
    ['PageDown', max - 1000],
  ] as const) {
    await page.keyboard.press(key);
    await expect(row).toHaveAttribute('data-value', String(want));
    if ((await page.getByTestId('sim-summary').getAttribute('aria-busy')) === 'true') {
      seenBusy = true;
    }
    await expect(page.getByTestId('sim-loading')).toHaveCount(0);
    await freshRun(page);
    // After the new run arrived the thumb still has focus (no remount).
    await expect(thumb, key).toBeFocused();
    await expect(page.getByTestId('sim-check-status')).toHaveAttribute('data-ok', 'true');
  }
  // The stale marking showed at least once (each change recomputes the run).
  expect(seenBusy).toBe(true);
});

test('B54 tester: a typed value outside the machine range is not stored', async ({ page }) => {
  test.setTimeout(180_000);
  await setup(page);
  const row = page.locator('[data-testid^="sim-spindle-T"][data-value]').first();
  const before = await row.getAttribute('data-value');
  const max = Number(await row.getByRole('slider').getAttribute('aria-valuemax'));
  const input = row.locator('input[data-testid$="-input"]');
  await input.fill(String(max + 5000));
  await input.press('Enter');
  await input.blur();
  // Either refused (value unchanged) or clamped into the range: never above the maximum.
  await expect
    .poll(async () => Number(await row.getAttribute('data-value')))
    .toBeLessThanOrEqual(max);
  const after = Number(await row.getAttribute('data-value'));
  expect([Number(before), max]).toContain(after);
  await freshRun(page);
  await expect(page.getByTestId('sim-check-status')).toHaveAttribute('data-ok', 'true');
});

for (const width of [1440, 390]) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`B54 tester: Kesim ayarları ${width} ${scheme}, axe, no horizontal scroll`, async ({
      page,
    }) => {
      test.setTimeout(180_000);
      await page.emulateMedia({ colorScheme: scheme });
      // Build the job at desktop width (the phone layout hides the summary), then narrow the window.
      await setup(page);
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      // At phone width the settings panel opens from the 'Ayarlar' button.
      if (width < 1024) await page.getByRole('button', { name: 'Ayarlar', exact: true }).click();
      const cutting = page.getByTestId('sim-cutting');
      await cutting.scrollIntoViewIfNeeded();
      await toastsSettled(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
      // The settings panel itself does not scroll sideways (a long tool name stays inside it).
      const inner = await cutting.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(inner, 'Kesim ayarları panel overflows sideways').toBeLessThanOrEqual(1);
      for (const block of ['sim-cutting-tools', 'sim-cutting-spindle']) {
        const el = page.getByTestId(block);
        await el.scrollIntoViewIfNeeded();
        await el.screenshot({ path: `__screenshots__/b54-${block}-${width}-${scheme}.png` });
      }
      const res = await new AxeBuilder({ page }).analyze();
      const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
      expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
    });
  }
}
