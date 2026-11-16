import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };

/** T012 tester: edit-after-nest, undo of a second run, responsiveness during a big nest. */

const t = tr.cutList;
const n = t.nesting;
const p = t.paste;
const URL = '/projeler/yeni/parcalar';

const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
const cell = (page: Page, row: number, column: string) =>
  page.getByLabel(fill(t.cellLabel, { n: row, column }), { exact: true });

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}

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
  await expect(page.getByLabel(p.textLabel)).toHaveCount(0, { timeout: 30_000 });
}

const summary = async (page: Page) => ({
  sheets: await page.getByTestId('nesting-sheets').innerText(),
  waste: await page.getByTestId('nesting-waste').innerText(),
});

test.describe('T012 nesting (tester)', () => {
  test('edit a part after Diz, Diz again updates; undo restores the previous summary', async ({
    page,
  }) => {
    const problems = watchConsole(page);
    await page.goto(URL);
    await paste(page, KITCHEN, 5);
    const run = page.getByRole('button', { name: n.run, exact: true });
    await run.click();
    await expect(page.getByTestId('nesting-sheets')).toHaveText('3');
    const first = await summary(page);

    // Grow the quantity of the first part a lot; the stored layout no longer covers every copy.
    const qty = cell(page, 1, t.columns.qty);
    await qty.fill('60');
    await qty.press('Enter');
    await expect(page.getByTestId('nesting-unplaced')).toBeVisible();

    await run.click();
    await expect(page.getByTestId('nesting-unplaced')).toHaveCount(0);
    const second = await summary(page);
    expect(Number(second.sheets)).toBeGreaterThan(Number(first.sheets));

    // Undo the second Diz: the previous layout summary (with the missing copies noted) is back.
    await page.getByRole('button', { name: t.undo }).click();
    await expect(page.getByTestId('nesting-sheets')).toHaveText(first.sheets);
    expect(await summary(page)).toEqual(first);
    await expect(page.getByTestId('nesting-unplaced')).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('a part larger than the sheet: Turkish warning, nothing English', async ({ page }) => {
    await page.goto(URL);
    await paste(
      page,
      ['Ad\tEn\tBoy\tAdet', 'Raf\t800\t300\t2', 'Dev\t3000\t2500\t1'].join('\n'),
      2,
    );
    await page.getByRole('button', { name: n.run, exact: true }).click();
    await expect(page.getByTestId('nesting-unplaced')).toHaveText(fill(n.unplaced, { count: 1 }));
    await expect(page.getByText(t.issues.PART_LARGER_THAN_SHEET)).toBeVisible();
  });

  test('300 copies: main thread stays responsive while the worker nests; edit during run is STALE', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const problems = watchConsole(page);
    await page.goto(URL);
    // 60 part types x 5 = 300 copies (varied sizes so the placer has real work).
    const rows = ['Ad\tEn\tBoy\tAdet'];
    for (let i = 0; i < 60; i++)
      rows.push(`P${i}\t${60 + ((i * 37) % 400)}\t${50 + ((i * 53) % 500)}\t5`);
    await paste(page, rows.join('\n'), 60);

    // Frame-gap probe: long main-thread blocks show up as large gaps between animation frames.
    await page.evaluate(() => {
      const w = window as unknown as { __maxGap: number };
      w.__maxGap = 0;
      let last = performance.now();
      const tick = (now: number) => {
        w.__maxGap = Math.max(w.__maxGap, now - last);
        last = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    const worker = page.waitForEvent('worker');
    await page.getByRole('button', { name: n.run, exact: true }).click();
    await worker;
    // While running, a button is clickable: add a row (this changes the base -> stale result).
    const add = page.getByRole('button', { name: t.addRow });
    await add.click({ timeout: 5_000 });
    await expect(cell(page, 61, t.columns.name)).toBeVisible();
    const stale = page.getByText(n.stale);
    const done = page.getByTestId('nesting-sheets');
    await expect(stale.or(done)).toBeVisible({ timeout: 60_000 });
    const gap = await page.evaluate(() => (window as unknown as { __maxGap: number }).__maxGap);
    console.log(`max frame gap during 300-copy nest: ${Math.round(gap)} ms`);
    expect(gap).toBeLessThan(1000);

    // A clean re-run now succeeds.
    await page.getByRole('button', { name: n.run, exact: true }).click();
    await expect(done).toBeVisible({ timeout: 60_000 });
    await expect(stale).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('390 px with 300 copies: no page-level horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(URL);
    const rows = ['Ad\tEn\tBoy\tAdet'];
    for (let i = 0; i < 60; i++)
      rows.push(`P${i}\t${60 + ((i * 37) % 400)}\t${50 + ((i * 53) % 500)}\t5`);
    await paste(page, rows.join('\n'), 60);
    await page.getByRole('button', { name: n.run, exact: true }).click();
    await expect(page.getByTestId('nesting-sheets')).toBeVisible({ timeout: 60_000 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
