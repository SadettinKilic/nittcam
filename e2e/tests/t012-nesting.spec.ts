import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { goStep, nest, openWorkspacePanel } from './wizard-helpers';

/** T012: "Diz" on the parts page runs the placer in a Web Worker and shows sheets + waste %. */

const t = tr.cutList;
const n = t.nesting;
const p = t.paste;
const URL = '/projeler/yeni/parcalar';

const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}

/** A small kitchen order: 30 pieces on the 2800 × 2070 draft sheet; the placer (deterministic) uses 3 sheets. */
const KITCHEN = [
  'Parça adı\tEn\tBoy\tAdet\tDamar',
  'Yan\t560\t720\t8\tevet',
  'Taban\t564\t560\t4\thayır',
  'Kapak\t596\t716\t6\tevet',
  'Raf\t564\t520\t8\thayır',
  'Çekmece önü\t596\t176\t4\tevet',
].join('\n');

async function paste(page: Page, text: string, count: number) {
  await page.getByRole('button', { name: t.pasteOpen }).click();
  await page.getByLabel(p.textLabel).fill(text);
  await page.getByRole('button', { name: fill(p.applyCount, { count }) }).click();
  await expect(page.getByLabel(p.textLabel)).toHaveCount(0);
}

test.describe('T012 nesting', () => {
  test('Diz runs in a Web Worker, shows sheet count and waste %, undo/redo', async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto(URL);
    await goStep(page, 'dizilim');
    const run = page.getByRole('button', { name: n.run, exact: true });
    await expect(run).toBeDisabled();
    await goStep(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    // T261: entering Dizilim with parts and no layout runs the nesting by itself (no click).
    const worker = page.waitForEvent('worker');
    await goStep(page, 'dizilim');
    await worker;
    await expect(page.getByTestId('nesting-sheets')).toHaveText('3');
    await expect(page.getByTestId('nesting-waste')).toHaveText(/^%\d+(,\d)?$/);
    // T249: the plate tabs carry each plate's waste once (no per-plate prose lines).
    const tabs = page.getByTestId('sheet-tabs-scroll').getByRole('tab');
    await expect(tabs).toHaveCount(3);
    for (let i = 0; i < 3; i++) await expect(tabs.nth(i)).toContainText(/fire %\d+(,\d)?/);
    await expect(page.getByTestId('nesting-unplaced')).toHaveCount(0);
    await page.screenshot({ path: '__screenshots__/t012-dizilim.png', fullPage: true });

    // Running again on the same parts changes nothing.
    await run.click();
    await expect(page.getByText(n.unchanged)).toBeVisible();

    // One undo step removes the layout; redo brings it back.
    await page.getByTestId('wizard-undo').click();
    await expect(page.getByText(n.none)).toBeVisible();
    await page.getByRole('button', { name: t.redo }).click();
    await expect(page.getByTestId('nesting-sheets')).toHaveText('3');
    expect(problems).toEqual([]);
  });

  test('a part larger than the sheet stays out of the layout with a warning', async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto(URL);
    await paste(
      page,
      ['Ad\tEn\tBoy\tAdet', 'Raf\t800\t300\t2', 'Dev\t3000\t2500\t1'].join('\n'),
      2,
    );
    // T118: the row shows a warning icon (text in its tooltip / accessible name).
    await expect(
      page.locator('[data-testid^=row-issue-][data-codes*=PART_LARGER_THAN_SHEET]'),
    ).toBeVisible();
    await nest(page);
    await expect(page.getByTestId('nesting-sheets')).toHaveText('1');
    await expect(page.getByTestId('nesting-unplaced')).toHaveText(fill(n.unplaced, { count: 1 }));
    await page.screenshot({ path: '__screenshots__/t012-sigmayan-parca.png', fullPage: true });
    expect(problems).toEqual([]);
  });

  test('390 px: the nesting panel fits without page-level horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(URL);
    await paste(page, KITCHEN, 5);
    await nest(page);
    // T198: below 1024 px the nesting summary lives in the left bottom sheet.
    await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
    const panel = await openWorkspacePanel(page, 'left');
    await expect(panel.getByTestId('nesting-sheets')).toHaveText('3');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page
      .getByRole('heading', { name: n.title, level: 2, exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: '__screenshots__/t012-mobil-dizilim.png' });
  });
});
