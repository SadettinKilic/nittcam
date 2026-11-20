import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { goStep, openNewProject, pasteAndNest, saved, toastsSettled } from './wizard-helpers';

// T307 (D-095): spindle speed per tool in Simülasyon "Kesim ayarları": slider + typed field over
// the machine's range, the recommended value marked, a warning line outside ±20 %, keyboard
// operable, one command per change (Ctrl+Z undoes it), "Önerilene dön" clears it.

const s = tr.simulation.cutting.spindle;

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

test('T307: spindle speed slider, typed value, warning band, undo and reset', async ({ page }) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page, 'Ad\tEn\tBoy\tAdet\nYan\t560\t720\t1', 1);
  await saved(page);
  await goStep(page, 'simulasyon');

  const block = page.getByTestId('sim-cutting-spindle');
  await expect(block).toBeVisible({ timeout: 30_000 });
  const row = block.locator('[data-testid^="sim-spindle-T"][data-value]').first();
  const recommended = Number(await row.getAttribute('data-value'));
  expect(recommended).toBeGreaterThan(0);
  const status = row.locator('[data-testid$="-status"]');
  await expect(status).toHaveAttribute('data-band', 'ok');
  await expect(row.locator('[data-testid$="-slider-mark"]')).toHaveText(
    s.recommended.replace('{value}', new Intl.NumberFormat('tr-TR').format(recommended)),
  );
  const thumb = row.getByRole('slider');
  await expect(thumb).toHaveAttribute('aria-valuetext', /devir\/dk$/);
  await expect(page.getByTestId('sim-check-status')).toHaveAttribute('data-ok', 'true', {
    timeout: 30_000,
  });

  // Keyboard: End = the machine maximum (well above +20 %), a warning line says why.
  await thumb.focus();
  await page.keyboard.press('End');
  const max = Number(await thumb.getAttribute('aria-valuemax'));
  await expect(row).toHaveAttribute('data-value', String(max));
  await expect(status).toHaveAttribute('data-band', 'high');
  await expect(row.getByTestId(/-reset$/)).toBeVisible();
  // PgDn = −1 000.
  await page.keyboard.press('PageDown');
  await expect(row).toHaveAttribute('data-value', String(max - 1000));
  await expect(page.getByTestId('sim-check-status')).toHaveAttribute('data-ok', 'true', {
    timeout: 30_000,
  });
  await axeClean(page);

  // Undo (focus outside a field) goes back one step.
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect(row).toHaveAttribute('data-value', String(max));

  // Typed value: rounded to 100, below −20 % → "düşük" line.
  const input = row.locator('input[data-testid$="-input"]');
  const low = Math.round((recommended * 0.7) / 100) * 100 + 40;
  await input.fill(String(low));
  await input.press('Enter');
  await expect(row).toHaveAttribute('data-value', String(Math.round(low / 100) * 100));
  await expect(status).toHaveAttribute('data-band', 'low');

  // "Önerilene dön" clears the project's value.
  await row.getByTestId(/-reset$/).click();
  await expect(row).toHaveAttribute('data-value', String(recommended));
  await expect(status).toHaveAttribute('data-band', 'ok');
  await expect(row.getByTestId(/-reset$/)).toHaveCount(0);
});
