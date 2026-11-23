import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { goStep, openNewProject, pasteAndNest, saved, toastsSettled } from './wizard-helpers';

// B59 tester: lower bounds refused in the UI, the G-code panel shows the İLERLEME header only with
// an own feed and GİRİŞ: rampa only with a ramp; whole-page axe on Simülasyon at 1440 and 390.

const c = tr.simulation.cutting;

async function axeClean(page: Page) {
  await toastsSettled(page);
  const res = await new AxeBuilder({ page }).analyze();
  const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
}

test('B59 tester: bounds, header lines, ramp in the program, axe', async ({ page }) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page, 'Ad\tEn\tBoy\tAdet\nYan\t560\t720\t1\nRaf\t300\t200\t1', 2);
  await saved(page);
  await goStep(page, 'simulasyon');
  const status = page.getByTestId('sim-check-status');
  await expect(status).toHaveAttribute('data-ok', 'true', { timeout: 30_000 });
  const gcodeText = async () => (await page.locator('body').innerText()).toUpperCase();
  expect(await gcodeText()).not.toContain('(ILERLEME T');
  expect(await gcodeText()).not.toContain('(GIRIS: RAMPA');

  const row = page.locator('[data-testid^="sim-spindle-T"][data-value]').first();
  await expect(row).toBeVisible();
  const rowId = (await row.getAttribute('data-testid')) as string;
  const feed = page.getByTestId(`${rowId}-feed`);
  const plunge = page.getByTestId(`${rowId}-plunge`);
  const before = await feed.inputValue();
  for (const [field, value] of [
    [feed, '99'],
    [plunge, '30001'],
  ] as const) {
    await field.fill(value);
    await field.press('Enter');
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await field.press('Escape');
  }
  await expect(feed).toHaveValue(before);

  await feed.fill('4200');
  await feed.press('Enter');
  await expect(status).toHaveAttribute('data-ok', 'true', { timeout: 30_000 });
  await expect.poll(gcodeText, { timeout: 30_000 }).toContain('(ILERLEME T');

  await page.getByTestId('sim-cutting').getByLabel(c.entry.ramp, { exact: true }).check();
  await expect(status).toHaveAttribute('data-ok', 'true', { timeout: 30_000 });
  await expect.poll(gcodeText, { timeout: 30_000 }).toContain('(GIRIS: RAMPA');

  await axeClean(page);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.getByTestId('sim-cutting').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `__screenshots__/b59-sim-1440-${scheme}.png` });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(over).toBeLessThanOrEqual(1);
  await axeClean(page);
  await page.screenshot({ path: `__screenshots__/b59-sim-390.png`, fullPage: true });
});
