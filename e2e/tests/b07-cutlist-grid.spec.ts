import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

  for (const width of [640, 768, 800, 1023]) {
    test(`tablet ${width} px: narrow columns, no sideways scroll; "Serbest" in the UI font`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(URL);
      await pasteRows(page, THREE, 3);
      const scroll = page.getByTestId('cut-list-scroll');
      await expect(page.getByTestId('cut-list-grid')).toBeVisible();
      expect(await scroll.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
      const grain = page.getByTestId('grain-cell-1');
      await expect(grain).toHaveText(t.grainCell.free);
      const fonts = await grain.evaluate((el) => [
        getComputedStyle(el).fontFamily,
        getComputedStyle(document.body).fontFamily,
      ]);
      expect(fonts[0]).toBe(fonts[1]);
      // Every column still edits: the note cell is there.
      await expect(cell(page, 1, t.columns.note)).toBeVisible();
    });
  }

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

/** Flicks the grid for 300 ms and returns a light row (text only, mounted mid-scroll) in view. */
async function flickToLightRow(page: Page, column: number) {
  return page.getByTestId('cut-list-scroll').evaluate(
    (el, col) =>
      new Promise<{ row: number; y: number; tdLeft: number; textLeft: number; textRight: number }>(
        (resolve, reject) => {
          const start = performance.now();
          const from = el.scrollTop;
          const step = (now: number) => {
            el.scrollTop = from + ((now - start) / 1000) * 3000;
            if (now - start < 300) {
              requestAnimationFrame(step);
              return;
            }
            const box = el.getBoundingClientRect();
            const light = [...el.querySelectorAll('[data-testid="cut-list-row"]')].find((r) => {
              const b = r.getBoundingClientRect();
              return b.top > box.top + 60 && b.bottom < box.bottom && !r.querySelector('input');
            });
            if (!light) {
              reject(new Error('no light row in view'));
              return;
            }
            const td = light.children[col] as HTMLElement;
            const range = document.createRange();
            range.selectNodeContents(td);
            const text = range.getBoundingClientRect();
            const b = td.getBoundingClientRect();
            resolve({
              row: Number(light.getAttribute('aria-rowindex')) - 1,
              y: b.top + b.height / 2,
              tdLeft: b.left,
              textLeft: text.left,
              textRight: text.right,
            });
          };
          requestAnimationFrame(step);
        },
      ),
    column,
  );
}

test.describe('B7 r3: band headers and the grain angle', () => {
  for (const width of [1440, 1920]) {
    test(`${width} px: the four band headers fit without truncation, no sideways scroll`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(URL);
      await pasteRows(page, THREE, 3);
      for (const edge of ['top', 'bottom', 'left', 'right'] as const) {
        const head = page.getByTestId(`edge-col-${edge}`).locator('span').first();
        await expect(head).toHaveText(fill(t.edgeHeader, { edge: t.edge[edge] }));
        expect(await head.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
      }
      const scroll = page.getByTestId('cut-list-scroll');
      expect(await scroll.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    });
  }

  test('a fixed angle ("0°") uses the UI font with tabular figures', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(URL);
    await pasteRows(page, THREE, 3);
    await page
      .getByRole('checkbox', { name: fill(t.cellLabel, { n: 1, column: t.columns.grain }) })
      .click();
    const grain = page.getByTestId('grain-cell-1');
    await expect(grain).toHaveText(/0°/);
    const [font, body, numeric] = await grain.evaluate((el) => [
      getComputedStyle(el).fontFamily,
      getComputedStyle(document.body).fontFamily,
      getComputedStyle(el).fontVariantNumeric,
    ]);
    expect(font).toBe(body);
    expect(numeric).toContain('tabular-nums');
  });
});

test.describe('B7 r3: a press on a light row', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(URL);
    const lines = ['Ad\tEn\tBoy\tAdet'];
    for (let i = 1; i <= 300; i++) lines.push(`Parça ${i}\t${100 + i}\t200\t1`);
    await pasteRows(page, lines.join('\n'), 300);
  });

  test('puts the caret where the click was (start / end of the name), in edit mode', async ({
    page,
  }) => {
    const a = await flickToLightRow(page, 1);
    await page.mouse.click(a.textLeft + 1, a.y);
    const nameA = cell(page, a.row, t.columns.name);
    await expect(nameA).toBeFocused();
    expect(
      await nameA.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd]),
    ).toEqual([0, 0]);
    // Edit mode: ArrowRight moves the caret instead of leaving the cell.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('X');
    await page.keyboard.press('Tab');
    await expect(nameA).toHaveValue(`PXarça ${a.row}`);

    const b = await flickToLightRow(page, 1);
    await page.mouse.click(b.textRight + 2, b.y);
    const nameB = cell(page, b.row, t.columns.name);
    await expect(nameB).toBeFocused();
    const len = `Parça ${b.row}`.length;
    expect(
      await nameB.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd]),
    ).toEqual([len, len]);
  });

  test('a press on a light row number toggles its checkbox; a numeric cell gets focus', async ({
    page,
  }) => {
    const a = await flickToLightRow(page, 0);
    await page.mouse.click(a.tdLeft + 12, a.y);
    await expect(page.getByTestId(`row-select-${a.row}`)).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId(`row-select-${a.row}`)).toBeFocused();

    const b = await flickToLightRow(page, 2);
    await page.mouse.click(b.textRight - 1, b.y);
    await expect(cell(page, b.row, t.columns.w)).toBeFocused();
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

  test('full width only for Parçalar without issues: Dışa aktar keeps two columns at 1440 px', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/projeler/yeni?adim=export');
    const aside = page.locator('#step-content > aside');
    await expect(aside).toBeVisible();
    const [left, right] = await page.evaluate(() => {
      const kids = [...document.querySelectorAll('#step-content > *')];
      return kids.slice(0, 2).map((k) => k.getBoundingClientRect().toJSON() as DOMRect);
    });
    // Side by side: same top, the main column starts right of the checklist.
    expect(Math.abs((left?.top ?? 0) - (right?.top ?? -99))).toBeLessThan(2);
    expect(right?.left ?? 0).toBeGreaterThan((left?.right ?? 0) - 1);
  });

  test('the how-to sentence lives in the empty state and the import dialog', async ({ page }) => {
    await page.goto(URL);
    await expect(page.getByText(t.subtitle)).toHaveCount(1);
    await page.getByRole('button', { name: t.pasteOpen }).click();
    // T250 (T248 import bullet): one-sentence intro; the how-to is in the info popover.
    const panel = page.locator('#paste-panel');
    await expect(panel.getByText(t.paste.intro)).toBeVisible();
    await expect(page.getByText(t.subtitle)).toHaveCount(1);
    await panel.getByRole('button', { name: t.paste.about }).click();
    await expect(page.getByRole('dialog').getByText(t.subtitle)).toBeVisible();
    await expect(page.getByRole('dialog').getByText(t.paste.help)).toBeVisible();
  });
});

test.describe('T119 row actions, multi-select, bulk edit', () => {
  test('row menu: duplicate, move down, delete with an undo toast', async ({ page }) => {
    await page.goto(URL);
    await pasteRows(page, THREE, 3);
    const menu = (n: number) => page.getByRole('button', { name: fill(t.rowMenu.label, { n }) });

    await menu(1).click();
    await page.getByRole('menuitem', { name: t.rowMenu.duplicate }).click();
    await expect(cell(page, 2, t.columns.name)).toHaveValue('Yan');

    await menu(1).click();
    await page.getByRole('menuitem', { name: t.rowMenu.moveDown }).click();
    await expect(cell(page, 1, t.columns.name)).toHaveValue('Yan');
    await expect(cell(page, 3, t.columns.name)).toHaveValue('Raf');
    await menu(3).click();
    await page.getByRole('menuitem', { name: t.rowMenu.moveUp }).click();
    await expect(cell(page, 2, t.columns.name)).toHaveValue('Raf');

    await menu(2).click();
    await page.getByRole('menuitem', { name: t.rowMenu.remove }).click();
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(t.count, { rows: 3, pieces: 6 }),
    );
    const toast = page
      .locator('[data-sonner-toast]')
      .filter({ hasText: fill(t.removed, { count: 1 }) });
    await toast.getByRole('button', { name: t.undo }).click();
    await expect(cell(page, 2, t.columns.name)).toHaveValue('Raf');
  });

  test('Ctrl/Shift multi-select, Ctrl+D and Delete act on the selection', async ({ page }) => {
    await page.goto(URL);
    await pasteRows(page, THREE, 3);
    await page.getByTestId('row-select-1').click();
    await page.getByTestId('row-select-3').click({ modifiers: ['Shift'] });
    await expect(page.getByTestId('selection-bar')).toContainText(
      fill(t.select.count, { count: 3 }),
    );
    await page.getByTestId('row-select-2').click({ modifiers: ['Control'] });
    await expect(page.getByTestId('selection-bar')).toContainText(
      fill(t.select.count, { count: 2 }),
    );

    // Ctrl+D on a selected row duplicates the selection (each copy after its original).
    await page.getByTestId('row-select-1').focus();
    await page.keyboard.press('Control+d');
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(t.count, { rows: 5, pieces: 12 }),
    );
    await expect(cell(page, 2, t.columns.name)).toHaveValue('Yan');
    await expect(cell(page, 5, t.columns.name)).toHaveValue('Kapak');

    // Delete outside a text cell removes the selection; one undo brings it back.
    await page.getByTestId('row-select-1').focus();
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(t.count, { rows: 3, pieces: 8 }),
    );
    await page.getByTestId('wizard-undo').click();
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(t.count, { rows: 5, pieces: 12 }),
    );
  });

  test('bulk edit of 50 rows is one undo step; footer summary matches a hand calculation', async ({
    page,
  }) => {
    await page.goto(URL);
    const lines = ['Ad\tEn\tBoy\tAdet'];
    for (let i = 1; i <= 50; i++) lines.push(`P${i}\t500\t400\t1`);
    await pasteRows(page, lines.join('\n'), 50);
    // 50 × 0.2 m² = 10 m²; usable 2800 × 2070 sheet minus the default margin → 2 sheets.
    await expect(page.getByTestId('cut-list-area')).toHaveText(
      fill(t.summary.area, { area: '10' }),
    );
    await expect(page.getByTestId('cut-list-sheets')).toHaveAttribute('data-value', '2');

    await page.getByTestId('row-select-all').click();
    await expect(page.getByTestId('selection-bar')).toContainText(
      fill(t.select.count, { count: 50 }),
    );
    await page.getByTestId('bulk-open').click();
    const sheet = page.getByTestId('bulk-edit');
    await sheet.getByTestId('bulk-qty').fill('2');
    await sheet.getByTestId('bulk-edge-top').fill('0,8');
    await sheet.getByTestId('bulk-prefix').fill('Mutfak ');
    await sheet.getByTestId('bulk-apply').click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(t.count, { rows: 50, pieces: 100 }),
    );
    await expect(cell(page, 1, t.columns.name)).toHaveValue('Mutfak P1');
    await expect(page.getByTestId('cut-list-area')).toHaveText(
      fill(t.summary.area, { area: '20' }),
    );

    await page.getByTestId('wizard-undo').click();
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(t.count, { rows: 50, pieces: 50 }),
    );
    await expect(cell(page, 1, t.columns.name)).toHaveValue('P1');
    await expectNoA11yViolations(page, { exclude: ['[data-sonner-toaster]'] });
  });

  test('Enter in a bulk edit field applies the sheet', async ({ page }) => {
    await page.goto(URL);
    await pasteRows(page, ['Ad\tEn\tBoy\tAdet', 'A\t500\t400\t1', 'B\t500\t400\t1'].join('\n'), 2);
    await page.getByTestId('row-select-all').click();
    await page.getByTestId('bulk-open').click();
    const sheet = page.getByTestId('bulk-edit');
    await sheet.getByTestId('bulk-qty').fill('3');
    await sheet.getByTestId('bulk-qty').press('Enter');
    await expect(sheet).toHaveCount(0);
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(t.count, { rows: 2, pieces: 6 }),
    );
  });
});

test.describe('T120 import and export', () => {
  const XLSX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'kesim-listesi.xlsx');

  test('İçe aktar: a real .xlsx (title row, empty row, Turkish text) → mapping preview → rows', async ({
    page,
  }) => {
    const problems = watchConsole(page);
    await page.goto(URL);
    await page.getByRole('button', { name: t.pasteOpen }).click();
    await page.getByTestId('import-file').setInputFiles(XLSX);
    await expect(page.getByTestId('import-file-state')).toHaveAttribute('data-state', 'loaded');
    await expect(page.getByLabel(p.textLabel)).toHaveValue(/^Parça adı\tEn\tBoy/);
    await page.getByRole('button', { name: fill(p.applyCount, { count: 2 }) }).click();
    await expect(cell(page, 1, t.columns.name)).toHaveValue('Çekmece önü');
    await expect(cell(page, 1, t.columns.w)).toHaveValue('596,5');
    await expect(cell(page, 2, t.columns.qty)).toHaveValue('2');
    expect(problems).toEqual([]);
  });

  test('wrong type and oversized files are rejected with a Turkish message', async ({ page }) => {
    await page.goto(URL);
    await page.getByRole('button', { name: t.pasteOpen }).click();
    const input = page.getByTestId('import-file');
    await input.setInputFiles({
      name: 'resim.png',
      mimeType: 'image/png',
      buffer: Buffer.from('x'),
    });
    await expect(page.getByTestId('import-error')).toHaveText(p.file.errors.type);
    await input.setInputFiles({
      name: 'buyuk.csv',
      mimeType: 'text/csv',
      buffer: Buffer.alloc(5 * 1024 * 1024 + 1, 65),
    });
    await expect(page.getByTestId('import-error')).toHaveText(p.file.errors.size);
    await expect(page.getByLabel(p.textLabel)).toHaveValue('');
  });

  test('Dışa aktar CSV → re-import gives the same rows', async ({ page }) => {
    await page.goto(URL);
    await pasteRows(page, THREE, 3);
    await cell(page, 1, t.columns.note).fill('Beyaz; parlak');
    await cell(page, 1, t.columns.note).press('Tab');
    await page.getByTestId('band-cell-2').click();
    await page
      .getByLabel(fill(t.edgeLabel, { n: 2, edge: t.edge.left }), { exact: true })
      .fill('0,8');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');

    const values = async () =>
      page
        .getByTestId('cut-list-row')
        .evaluateAll((rows) =>
          rows.map((r) =>
            [...r.querySelectorAll('input[type=text]')].map((i) => (i as HTMLInputElement).value),
          ),
        );
    const before = await values();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('cut-list-export').click(),
    ]);
    expect(download.suggestedFilename()).toBe(t.exportFile);
    const file = await download.path();

    await page.getByTestId('row-select-all').click();
    await page.getByTestId('selection-remove').click();
    await expect(page.getByText(t.empty)).toBeVisible();

    await page.getByRole('button', { name: t.pasteOpen }).click();
    // The saved download has no extension; give the file its real name back.
    await page.getByTestId('import-file').setInputFiles({
      name: download.suggestedFilename(),
      mimeType: 'text/csv',
      buffer: readFileSync(file),
    });
    await expect(page.getByTestId('import-file-state')).toHaveAttribute('data-state', 'loaded');
    await page.getByRole('button', { name: fill(p.applyCount, { count: 3 }) }).click();
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(t.count, { rows: 3, pieces: 8 }),
    );
    expect(await values()).toEqual(before);
  });
});
