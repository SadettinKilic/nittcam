import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { fill, goStep, openNewProject, pasteAndNest, saved, toastsSettled } from './wizard-helpers';

// T288 (CTO review #10 E1): "Kesim ayarları" on Simülasyon: tabs (every part / small parts only /
// off), count, width, height, lead-in and direction; every change is a command (Ctrl+Z undoes it)
// and the simulation's tab count follows at once.

async function axeClean(page: Page) {
  // The reset/undo toast fades in; axe sometimes measured its action button (.bg-accent!)
  // mid-fade and reported a contrast error. Let every toast and animation finish first.
  await toastsSettled(page);
  await expect
    .poll(() =>
      page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').length),
    )
    .toBe(0);
  const res = await new AxeBuilder({ page }).analyze();
  const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
}

const c = tr.simulation.cutting;

test('T288: cutting settings change the program at once and undo', async ({ page }) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  // One large part and two small ones (80 × 80: the safety rule gives them tabs).
  await pasteAndNest(page, 'Ad\tEn\tBoy\tAdet\nYan\t560\t720\t1\nTakoz\t80\t80\t2', 2);
  await saved(page);
  await goStep(page, 'simulasyon');

  const panel = page.getByTestId('sim-cutting');
  await expect(panel).toBeVisible({ timeout: 30_000 });
  const tabs = page.getByTestId('sim-summary-tabs');
  await expect(tabs).toBeVisible({ timeout: 30_000 });
  // A new project starts with tabs on every part.
  await expect(page.getByTestId('sim-cutting-tabs')).toHaveAttribute('data-value', 'all');
  const all = Number(await tabs.textContent());

  // Small parts only: fewer tabs at once, the two small parts keep ≥ 2 each (safety rule).
  await panel.getByLabel(c.tabModes.small).check();
  await expect(page.getByTestId('sim-cutting-tabs')).toHaveAttribute('data-value', 'small');
  await expect.poll(async () => Number(await tabs.textContent())).toBeLessThan(all);
  const small = Number(await tabs.textContent());
  expect(small).toBeGreaterThanOrEqual(4);
  await axeClean(page);

  // Undo (Ctrl+Z outside a text field) goes back to every part.
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('sim-cutting-tabs')).toHaveAttribute('data-value', 'all');
  await expect.poll(async () => Number(await tabs.textContent())).toBe(all);

  // Off: no tabs anywhere, the small parts keep a thin skin (the safety rule still holds them).
  await panel.getByLabel(c.tabModes.off).check();
  await expect(page.getByTestId('sim-cutting-tabs-hint')).toHaveText(
    fill(c.tabHints.off, { skin: '0,5' }),
  );
  await expect.poll(async () => Number(await tabs.textContent())).toBe(0);
  await expect(page.getByTestId('sim-check-status')).toHaveAttribute('data-ok', 'true');

  // Own tab count on every part; lead-in and direction.
  await panel.getByLabel(c.tabModes.all).check();
  const count = page.getByTestId('sim-cutting-count');
  await count.fill('2');
  await count.press('Enter');
  await expect(page.getByTestId('sim-cutting-source')).toContainText(c.source.project);
  await panel.getByLabel(c.leadIns.line).check();
  await panel.getByLabel(c.directions.conventional).check();
  await expect(page.getByTestId('sim-cutting-lead')).toHaveAttribute('data-value', 'line');
  await expect(page.getByTestId('sim-cutting-direction')).toHaveAttribute(
    'data-value',
    'conventional',
  );
  await expect(page.getByTestId('sim-check-status')).toHaveAttribute('data-ok', 'true', {
    timeout: 30_000,
  });
  await page.getByTestId('sim-cutting-reset').click();
  await expect(page.getByTestId('sim-cutting-source')).not.toContainText(c.source.project);
  await axeClean(page);
});
