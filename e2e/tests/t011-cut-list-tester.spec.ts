import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { pickOption } from './wizard-helpers';

/** T011 tester: extra UI scenarios (320 px, keyboard-only, edit commit/revert, big paste). */

const t = tr.cutList;
const p = t.paste;
const URL = '/projeler/yeni/parcalar';

const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
const cell = (page: Page, n: number, column: string) =>
  page.getByLabel(fill(t.cellLabel, { n, column }), { exact: true });

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}

const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

const TSV =
  'Parça Adı\tEn\tBoy\tAdet\nKapak\t396,5\t716\t4\nRaf\t564\t300\t2\nSırt\t-5\t700\t1\nYan\t0\t10\t1';

test.describe('T011 cut list (tester)', () => {
  test('keyboard-only: open paste, paste text, apply, edit with Enter/Esc, no mouse', async ({
    page,
  }) => {
    const problems = watchConsole(page);
    await page.goto(URL);
    const open = page.getByRole('button', { name: t.pasteOpen });
    await open.focus();
    await page.keyboard.press('Enter');
    const area = page.getByLabel(p.textLabel);
    // Finding (minor): opening the panel does not move focus to the textarea; Tab reaches it.
    for (let i = 0; i < 5 && !(await area.evaluate((e) => e === document.activeElement)); i += 1) {
      await page.keyboard.press('Tab');
    }
    await expect(area).toBeFocused();
    await area.fill(TSV);
    // Tab through to the apply button without the mouse.
    const apply = page.getByRole('button', { name: fill(p.applyCount, { count: 2 }) });
    for (
      let i = 0;
      i < 40 && !(await apply.evaluate((e) => e === document.activeElement));
      i += 1
    ) {
      await page.keyboard.press('Tab');
    }
    await expect(apply).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(cell(page, 1, t.columns.name)).toHaveValue('Kapak');

    const w = cell(page, 1, t.columns.w);
    await w.focus();
    await w.fill('410');
    await page.keyboard.press('Enter');
    await expect(w).toHaveValue('410');
    // Enter moves down; typing and Esc reverts the second row.
    const w2 = cell(page, 2, t.columns.w);
    await expect(w2).toBeFocused();
    await w2.fill('999');
    await page.keyboard.press('Escape');
    await expect(w2).toHaveValue('564');
    expect(problems).toEqual([]);
  });

  test('invalid rows: Turkish messages and a skipped count; nothing English or raw', async ({
    page,
  }) => {
    await page.goto(URL);
    await page.getByRole('button', { name: t.pasteOpen }).click();
    await page.getByLabel(p.textLabel).fill(TSV);
    const preview = page.getByRole('table', { name: p.preview });
    await expect(preview.locator('tr[data-invalid="true"]')).toHaveCount(2);
    await expect(page.getByText(fill(p.summary, { valid: 2, invalid: 2 }))).toBeVisible();
    const text = await page.locator('main').innerText();
    expect(text).not.toMatch(/NOT_POSITIVE|INVALID_NUMBER|REQUIRED|must be|undefined|\{\w+\}/);
  });

  test('ambiguous unit: nothing is applied until a unit is chosen', async ({ page }) => {
    await page.goto(URL);
    await page.getByRole('button', { name: t.pasteOpen }).click();
    await page.getByLabel(p.textLabel).fill('Kapak\t39,6\t71,6\t2\nRaf\t56,4\t30\t1');
    const apply = page.getByRole('button', { name: fill(p.applyCount, { count: 2 }) });
    // PO decision (round 1): Uygula is disabled until a unit is chosen.
    await expect(apply).toBeDisabled();
    await expect(page.getByText(t.empty)).toBeVisible();
    await expect(page.getByRole('button', { name: t.undo })).toBeDisabled();
    await page.getByLabel(p.unit.mm).check();
    await apply.click();
    await expect(cell(page, 1, t.columns.w)).toHaveValue('39,6');
  });

  test('mapping change then apply: swapped w/h columns are honoured', async ({ page }) => {
    await page.goto(URL);
    await page.getByRole('button', { name: t.pasteOpen }).click();
    await page.getByLabel(p.textLabel).fill('Kapak\t500\t700\t2\nRaf\t600\t800\t1');
    await pickOption(page.getByLabel(fill(p.columnSelect, { n: 2 })), p.fields.h);
    await pickOption(page.getByLabel(fill(p.columnSelect, { n: 3 })), p.fields.w);
    await page.getByRole('button', { name: fill(p.applyCount, { count: 2 }) }).click();
    await expect(cell(page, 1, t.columns.w)).toHaveValue('700');
    await expect(cell(page, 1, t.columns.h)).toHaveValue('500');
  });

  test('2000-row paste applies as one undo step in reasonable time', async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto(URL);
    const lines = ['Parça Adı\tEn\tBoy\tAdet'];
    for (let i = 0; i < 2000; i += 1) lines.push(`P${i}\t${300 + (i % 400)},5\t${500 + i}\t1`);
    await page.getByRole('button', { name: t.pasteOpen }).click();
    await page.getByLabel(p.textLabel).fill(lines.join('\r\n') + '\r\n');
    const t0 = Date.now();
    await page.getByRole('button', { name: fill(p.applyCount, { count: 2000 }) }).click();
    await expect(page.getByTestId('cut-list-count')).toContainText('2000', { timeout: 15_000 });
    expect(Date.now() - t0).toBeLessThan(10_000);
    await page.getByRole('button', { name: t.undo }).click();
    await expect(page.getByText(t.empty)).toBeVisible();
    expect(problems).toEqual([]);
  });

  for (const width of [320, 390]) {
    test(`${width} px: no page-level horizontal scroll (empty, preview, list)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(URL);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await page.getByRole('button', { name: t.pasteOpen }).click();
      await page.getByLabel(p.textLabel).fill(TSV);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await page.getByRole('button', { name: fill(p.applyCount, { count: 2 }) }).click();
      await expect(cell(page, 1, t.columns.name)).toHaveValue('Kapak');
      expect(await overflow(page)).toBeLessThanOrEqual(0);
    });
  }
});

// BUG (T011, cut-list-editor.tsx:91 + :114): Enter commits the cell and moves focus to the next
// row; the blur of the old cell then commits again from a stale closure (draft still set), so a
// second no-op `updatePart` lands on the undo stack. One edit then needs two undos.
// Fixed in round 1: cell commits are idempotent and no-op commands leave no history.
test('Enter moving to the next row is still ONE undo step', async ({ page }) => {
  await page.goto(URL);
  await page.getByRole('button', { name: t.pasteOpen }).click();
  await page.getByLabel(p.textLabel).fill('Kapak\t500\t700\t2\nRaf\t600\t800\t1');
  await page.getByRole('button', { name: fill(p.applyCount, { count: 2 }) }).click();
  const w = cell(page, 1, t.columns.w);
  await w.fill('410');
  await page.keyboard.press('Enter');
  await expect(cell(page, 2, t.columns.w)).toBeFocused();
  await page.getByRole('button', { name: t.undo }).click();
  await expect(w).toHaveValue('500', { timeout: 2000 });
});
