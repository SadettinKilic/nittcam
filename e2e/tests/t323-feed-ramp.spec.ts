import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { goStep, openNewProject, pasteAndNest, saved, toastsSettled } from './wizard-helpers';

// T323: cutting feed and plunge feed per tool in Simülasyon "Kesim ayarları" (one command per
// change, Ctrl+Z, "İlerlemede önerilene dön", refused outside the machine limits).
// T324: contour entry "Dik dalma | Rampa" with angle and shortest length; the checks stay green.

const c = tr.simulation.cutting;
const s = c.spindle;

async function axeClean(page: Page) {
  await toastsSettled(page);
  await expect
    .poll(() =>
      page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length),
    )
    .toBe(0);
  const res = await new AxeBuilder({ page }).include('[data-testid="sim-cutting"]').analyze();
  const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
}

const checkOk = (page: Page) =>
  expect(page.getByTestId('sim-check-status')).toHaveAttribute('data-ok', 'true', {
    timeout: 30_000,
  });

test('T323 + T324: per-tool feed and plunge, ramp entry', async ({ page }) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page, 'Ad\tEn\tBoy\tAdet\nYan\t560\t720\t1', 1);
  await saved(page);
  await goStep(page, 'simulasyon');

  const panel = page.getByTestId('sim-cutting');
  const row = page.locator('[data-testid^="sim-spindle-T"][data-value]').first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await checkOk(page);
  const rowId = (await row.getAttribute('data-testid')) as string;
  const feed = page.getByTestId(`${rowId}-feed`);
  const plunge = page.getByTestId(`${rowId}-plunge`);
  const source = page.getByTestId(`${rowId}-feed-source`);
  await expect(source).toContainText(s.feedSource.recommended.split('(')[0] as string);
  const recommended = await feed.inputValue();

  // Own feed: one command, the source line says so, the checks stay green.
  await feed.fill('3500');
  await feed.press('Enter');
  await expect(source).toContainText(s.feedSource.project.split('(')[0] as string);
  await expect(page.getByTestId(`${rowId}-chip`)).toContainText('3.500');
  await checkOk(page);

  // A plunge faster than the feed warns (not refused).
  await plunge.fill('5000');
  await plunge.press('Enter');
  await expect(page.getByTestId(`${rowId}-plunge-warn`)).toHaveText(s.plungeFaster);

  // Above the machine limit: refused, the value in use stays.
  await feed.fill('70000');
  await feed.press('Enter');
  await expect(feed).toHaveAttribute('aria-invalid', 'true');
  await feed.press('Escape');
  await expect(feed).toHaveValue('3500');

  // Undo the plunge change, then "İlerlemede önerilene dön".
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId(`${rowId}-plunge-warn`)).toHaveCount(0);
  await page.getByTestId(`${rowId}-feeds-clear`).click();
  await expect(feed).toHaveValue(recommended);
  await expect(page.getByTestId(`${rowId}-feeds-clear`)).toHaveCount(0);

  // T324: ramp entry.
  const entry = page.getByTestId('sim-cutting-entry');
  await expect(entry).toHaveAttribute('data-value', 'straight');
  await expect(page.getByTestId('sim-cutting-entry-hint')).toHaveText(c.entry.hintStraight);
  await panel.getByLabel(c.entry.ramp, { exact: true }).check();
  await expect(entry).toHaveAttribute('data-value', 'ramp');
  const angle = page.getByTestId('sim-cutting-ramp-angle');
  await expect(angle).toHaveValue('3');
  await checkOk(page);
  await angle.fill('60');
  await angle.press('Enter');
  await expect(angle).toHaveAttribute('aria-invalid', 'true');
  await angle.fill('5');
  await angle.press('Enter');
  await expect(page.getByTestId('sim-cutting-entry-hint')).toContainText('5°');
  await checkOk(page);
  await axeClean(page);

  // Visual record of Kesim ayarları (desktop and phone, light and dark); no sideways scroll.
  for (const width of [1440, 390]) {
    for (const scheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      if (width < 1024 && !(await panel.isVisible())) {
        await page.getByRole('button', { name: 'Ayarlar', exact: true }).click();
      }
      await panel.scrollIntoViewIfNeeded();
      await toastsSettled(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
      const inner = await panel.evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(inner).toBeLessThanOrEqual(1);
      for (const block of ['sim-cutting-entry-block', `${rowId}-feeds`]) {
        const el = page.getByTestId(block);
        await el.scrollIntoViewIfNeeded();
        await el.screenshot({
          path: test.info().outputPath(`t323-${block}-${width}-${scheme}.png`),
        });
      }
      await axeClean(page);
    }
  }

  await panel.getByLabel(c.entry.straight, { exact: true }).check();
  await expect(entry).toHaveAttribute('data-value', 'straight');
  await expect(angle).toHaveCount(0);
});
