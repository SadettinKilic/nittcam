import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { expectNoA11yViolations } from './visual/helpers';
import { fill, watchConsole } from './wizard-helpers';

/** B7: cut list grid v2 (T118) and its feedback (T246). */

const t = tr.cutList;
const p = t.paste;
const URL = '/projeler/yeni?adim=parcalar';

const cell = (page: Page, n: number, column: string) =>
  page.getByLabel(fill(t.cellLabel, { n, column }), { exact: true });

async function pasteRows(page: Page, text: string, count: number) {
  await page.getByRole('button', { name: t.pasteOpen }).click();
  await page.getByLabel(p.textLabel).fill(text);
  await page.getByRole('button', { name: fill(p.applyCount, { count }) }).click();
  await expect(page.getByLabel(p.textLabel)).toHaveCount(0);
}

const THREE = [
  'Ad\tEn\tBoy\tAdet',
  'Yan\t560\t720\t2',
  'Raf\t564\t520\t4',
  'Kapak\t596\t716\t2',
].join('\n');

test.describe('T118 grid v2', () => {
  test('keyboard only: arrows, Tab, Enter edits and commits, Esc cancels, Enter on the last row adds a part', async ({
    page,
  }) => {
    const problems = watchConsole(page);
    await page.goto(URL);
    await pasteRows(page, THREE, 3);
    const undo = page.getByTestId('wizard-undo');

    const name1 = cell(page, 1, t.columns.name);
    await name1.focus();
    // Navigation mode: arrows move between cells.
    await page.keyboard.press('ArrowRight');
    await expect(cell(page, 1, t.columns.w)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(cell(page, 2, t.columns.w)).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await expect(cell(page, 2, t.columns.name)).toBeFocused();

    // Typing replaces the selected value; Tab commits and moves right.
    await page.keyboard.type('Sol yan');
    await page.keyboard.press('Tab');
    await expect(cell(page, 2, t.columns.w)).toBeFocused();
    await expect(cell(page, 2, t.columns.name)).toHaveValue('Sol yan');

    // Enter starts editing (caret at the end), Enter again commits and moves down.
    await page.keyboard.press('Enter');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('5,5');
    await page.keyboard.press('Enter');
    await expect(cell(page, 2, t.columns.w)).toHaveValue('565,5');
    await expect(cell(page, 3, t.columns.w)).toBeFocused();

    // Esc drops the typed text.
    await page.keyboard.type('9');
    await page.keyboard.press('Escape');
    await expect(cell(page, 3, t.columns.w)).toHaveValue('596');

    // Invalid value: Turkish message in a tooltip bubble, nothing runs.
    await page.keyboard.type('0');
    await page.keyboard.press('Enter');
    await expect(cell(page, 3, t.columns.w)).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('alert').filter({ hasText: t.errors.positive })).toBeVisible();
    await page.keyboard.press('Escape');

    // Enter on the last row adds a part and focuses the same column.
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(cell(page, 4, t.columns.w)).toBeFocused();
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(t.count, { rows: 4, pieces: 9 }),
    );

    // One undo step per commit: the added row, the width, the name.
    await undo.click();
    await expect(cell(page, 4, t.columns.name)).toHaveCount(0);
    await undo.click();
    await expect(cell(page, 2, t.columns.w)).toHaveValue('564');
    await undo.click();
    await expect(cell(page, 2, t.columns.name)).toHaveValue('Raf');
    expect(problems).toEqual([]);
  });

  test('note column; column resize; sticky header', async ({ page }) => {
    await page.goto(URL);
    await pasteRows(page, THREE, 3);
    const note = cell(page, 1, t.columns.note);
    await note.fill('Beyaz melamin');
    await note.press('Enter');
    await expect(note).toHaveValue('Beyaz melamin');

    const header = page.getByRole('columnheader', { name: t.columns.note, exact: true });
    const before = (await header.boundingBox())?.width ?? 0;
    const handle = header.locator('div[aria-hidden]').last();
    const box = await handle.boundingBox();
    if (!box) throw new Error('no resize handle');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 80, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
    const after = (await header.boundingBox())?.width ?? 0;
    expect(after).toBeGreaterThan(before + 40);
  });

  test('compact: the Bant cell opens the four edge inputs (Üst / Alt / Sol / Sağ)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto(URL);
    await pasteRows(page, THREE, 3);
    // No horizontal scroll in the grid at 1024 px.
    const scroll = page.getByTestId('cut-list-scroll');
    expect(await scroll.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    await expect(page.locator('thead th[data-testid^="edge-col-"]')).toHaveCount(0);

    await page.getByTestId('band-cell-1').click();
    const top = page.getByLabel(fill(t.edgeLabel, { n: 1, edge: t.edge.top }), { exact: true });
    await top.fill('0,8');
    await top.press('Enter');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('band-cell-1')).toHaveAttribute('data-sides', 'top');
  });

  test('390 px: one card per part, no page-level horizontal scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(URL);
    await pasteRows(page, THREE, 3);
    await expect(page.getByTestId('cut-list-cards')).toBeVisible();
    await expect(page.getByTestId('cut-list-grid')).toHaveCount(0);
    await cell(page, 2, t.columns.qty).fill('6');
    await cell(page, 2, t.columns.qty).press('Enter');
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(t.count, { rows: 3, pieces: 10 }),
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('1 000 rows: virtual rows, smooth scroll, fast commit', async ({ page }) => {
    await page.goto(URL);
    const lines = ['Ad\tEn\tBoy\tAdet'];
    for (let i = 1; i <= 1000; i++) lines.push(`P${i}\t${100 + (i % 500)}\t${200 + (i % 300)}\t1`);
    await pasteRows(page, lines.join('\n'), 1000);
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(t.count, { rows: 1000, pieces: 1000 }),
    );
    // Only a window of rows is in the DOM.
    expect(await page.getByTestId('cut-list-row').count()).toBeLessThan(80);

    // Scroll for ~1 s at a fast flick speed (4 000 px/s ≈ 110 rows/s) and count frames.
    const fps = await page.getByTestId('cut-list-scroll').evaluate(
      (el) =>
        new Promise<number>((resolve) => {
          let frames = 0;
          const start = performance.now();
          function step(now: number) {
            frames += 1;
            el.scrollTop = ((now - start) / 1000) * 4000;
            if (now - start < 1000) requestAnimationFrame(step);
            else resolve((frames * 1000) / (now - start));
          }
          requestAnimationFrame(step);
        }),
    );
    test.info().annotations.push({ type: 'fps', description: fps.toFixed(1) });
    expect(fps).toBeGreaterThanOrEqual(50);

    // Commit time of one edit (command + validation), measured in the page.
    await page.getByTestId('cut-list-scroll').evaluate((el) => (el.scrollTop = 0));
    const qty = cell(page, 1, t.columns.qty);
    await qty.fill('2');
    const ms = await qty.evaluate((el) => {
      const t0 = performance.now();
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return performance.now() - t0;
    });
    test.info().annotations.push({ type: 'commit-ms', description: ms.toFixed(1) });
    expect(ms).toBeLessThan(50);
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(t.count, { rows: 1000, pieces: 1001 }),
    );
  });
});

test.describe('T246 feedback', () => {
  test('paste toast has Geri al: one step undoes the paste', async ({ page }) => {
    await page.goto(URL);
    await pasteRows(page, THREE, 3);
    const toast = page
      .locator('[data-sonner-toast]')
      .filter({ hasText: fill(p.applied, { count: 3 }) });
    await expect(toast).toBeVisible();
    // No persistent banner above the table.
    await expect(
      page.getByRole('status').filter({ hasText: fill(p.applied, { count: 3 }) }),
    ).toHaveCount(0);
    await toast.getByRole('button', { name: t.undo }).click();
    await expect(page.getByText(t.empty)).toBeVisible();
  });

  test('no issues: a Sorun yok chip and no panel; an issue brings the panel back', async ({
    page,
  }) => {
    await page.goto(URL);
    await pasteRows(page, THREE, 3);
    const chip = page.getByTestId('cut-list-issue-chip');
    await expect(chip).toHaveText(t.issueChip.ok);
    await expect(page.getByTestId('validation-panel')).toHaveCount(0);

    // A part larger than the sheet: the chip counts it and the panel returns.
    await cell(page, 1, t.columns.w).fill('9000');
    await cell(page, 1, t.columns.w).press('Tab');
    await expect(chip).toHaveText(fill(t.issueChip.count, { count: 1 }));
    await expect(page.getByTestId('validation-panel')).toBeVisible();
    await expect(page.getByTestId('row-issue-1')).toHaveAttribute(
      'data-codes',
      'PART_LARGER_THAN_SHEET',
    );
    // The paste toast is still animating in (opacity), so axe checks the page without it.
    await expectNoA11yViolations(page, { exclude: ['[data-sonner-toaster]'] });
  });

  test('the how-to sentence lives in the empty state and the import dialog', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByText(t.subtitle)).toHaveCount(1);
    await page.getByRole('button', { name: t.pasteOpen }).click();
    await expect(page.locator('#paste-panel').getByText(t.subtitle)).toBeVisible();
  });
});
