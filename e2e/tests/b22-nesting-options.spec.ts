import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { goStep, KITCHEN, openNewProject, paste, watchConsole } from './wizard-helpers';

/**
 * B22 (T162–T163): mode cards, rotation policy, worker progress and "İptal" on the Dizilim step.
 * Cancel leaves the old layout untouched; results are kept per option set.
 */

const w = tr.wizard.layout;
const n = tr.cutList.nesting;

/**
 * 300 rows × 5 = 1500 small copies: three times the T163 "500 parts" case, so the "En hızlı" run
 * lasts long enough (several seconds) to press "İptal" while it runs.
 */
function manyParts(): string {
  const rows = ['Ad\tEn\tBoy\tAdet'];
  for (let i = 0; i < 300; i++)
    rows.push(`P${i}\t${40 + ((i * 37) % 260)}\t${40 + ((i * 53) % 210)}\t5`);
  return rows.join('\n');
}

const mode = (page: Page, m: 'minWaste' | 'fastest' | 'minToolChanges') =>
  page.getByRole('radio', { name: w.modes[m], exact: true });

test.describe('B22 nesting options', () => {
  test('mode cards and rotation policy are commands; each card keeps its last result', async ({
    page,
  }) => {
    const problems = watchConsole(page);
    await openNewProject(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    await goStep(page, 'dizilim');
    // T261: the first entry nests by itself (min waste).
    await expect(page.getByTestId('nesting-sheets')).toBeVisible({ timeout: 20_000 });
    const group = page.getByTestId('layout-mode');
    await expect(group).toHaveAttribute('data-value', 'minWaste');
    await expect(page.getByTestId('layout-mode-result-minWaste')).toBeVisible();
    await expect(page.getByTestId('layout-mode-result-fastest')).toHaveCount(0);

    await mode(page, 'fastest').click();
    await expect(group).toHaveAttribute('data-value', 'fastest');
    await page.getByRole('button', { name: n.run, exact: true }).click();
    await expect(page.getByTestId('layout-mode-result-fastest')).toBeVisible({ timeout: 20_000 });

    // Back to min waste: its result is reused (no worker run, no progress bar).
    await mode(page, 'minWaste').click();
    await expect(group).toHaveAttribute('data-value', 'minWaste');
    await page.getByRole('button', { name: n.run, exact: true }).click();
    await expect(page.getByTestId('nesting-progress')).toHaveCount(0);

    // Rotation policy: one radio group, default "free".
    const rotation = page.getByTestId('layout-rotation');
    await expect(rotation).toHaveAttribute('data-value', 'free');
    await page.getByRole('radio', { name: w.rotations.none, exact: true }).click();
    await expect(rotation).toHaveAttribute('data-value', 'none');
    await page.keyboard.press('Control+z');
    await expect(rotation).toHaveAttribute('data-value', 'free');
    expect(problems).toEqual([]);
  });

  test('1500 copies: progress while running, "İptal" keeps the old layout, no long task', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const problems = watchConsole(page);
    await openNewProject(page, 'parcalar');
    await paste(page, manyParts(), 300);
    await goStep(page, 'dizilim');
    const sheets = page.getByTestId('nesting-sheets');
    await expect(sheets).toBeVisible({ timeout: 60_000 });
    const before = {
      sheets: await sheets.textContent(),
      waste: await page.getByTestId('nesting-waste').textContent(),
    };

    // "En hızlı" measures the travel too: the slowest mode, so there is time to cancel.
    await mode(page, 'fastest').click();
    await expect(page.getByTestId('layout-mode')).toHaveAttribute('data-value', 'fastest');

    // Long tasks on the main thread while the worker runs.
    await page.evaluate(() => {
      const g = window as unknown as { __long: number[]; __obs: PerformanceObserver };
      g.__long = [];
      g.__obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) g.__long.push(e.duration);
      });
      g.__obs.observe({ type: 'longtask' });
    });

    await page.getByRole('button', { name: n.run, exact: true }).click();
    const progress = page.getByTestId('nesting-progress');
    await expect(progress).toBeVisible();
    await expect(page.getByRole('progressbar', { name: n.progress })).toBeVisible();
    await page.getByTestId('nesting-cancel').click();
    await expect(page.getByText(n.cancelled)).toBeVisible();
    await expect(progress).toHaveCount(0);
    const long = await page.evaluate(() => {
      const g = window as unknown as { __long: number[]; __obs: PerformanceObserver };
      g.__obs.disconnect();
      return g.__long;
    });
    console.log(`long tasks while nesting 1500 copies: ${JSON.stringify(long)}`);
    expect(long.filter((d) => d >= 50)).toEqual([]);

    // Nothing was recorded: the same layout and figures as before.
    await expect(sheets).toHaveText(before.sheets ?? '');
    await expect(page.getByTestId('nesting-waste')).toHaveText(before.waste ?? '');
    await expect(page.getByTestId('layout-mode-result-fastest')).toHaveCount(0);
    // A new run after the cancel works.
    await page.getByRole('button', { name: n.run, exact: true }).click();
    await expect(page.getByTestId('layout-mode-result-fastest')).toBeVisible({ timeout: 60_000 });
    expect(problems).toEqual([]);
  });
});
