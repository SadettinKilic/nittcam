import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { pickOption } from './wizard-helpers';

/** T011: cut-list grid + Excel/CSV paste. Screenshots go to e2e/__screenshots__/. */

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

/** As Excel copies it: tab separated, Turkish decimal comma, header row, one bad row. */
const SAMPLE_TSV = [
  'Parça adı\tEn\tBoy\tAdet\tDamar\tBant',
  'Kapak\t396,5\t716\t4\tevet\t0,8',
  'Raf\t564\t300\t2\thayır\t',
  'Arkalık\tabc\t700\t1\t\t',
  'Çekmece önü\t446\t140\t\tx\t1',
].join('\n');

async function openPaste(page: Page) {
  await page.getByRole('button', { name: t.pasteOpen }).click();
  const area = page.getByLabel(p.textLabel);
  await expect(area).toBeFocused();
  return area;
}

test.describe('T011 cut list', () => {
  // T118: a wide grid shows the four band columns.
  test.use({ viewport: { width: 1600, height: 900 } });

  test('paste TSV → preview with mapping and errors → Uygula → rows → undo/redo', async ({
    page,
  }) => {
    const problems = watchConsole(page);
    await page.goto(URL);
    await expect(page.getByRole('heading', { level: 1, name: t.title })).toBeVisible();
    await expect(page.getByText(t.empty)).toBeVisible();
    await expect(page.getByTestId('wizard-undo')).toBeDisabled();

    const area = await openPaste(page);
    await area.fill(SAMPLE_TSV);

    // Auto mapping from the Turkish header.
    const expected = ['name', 'w', 'h', 'qty', 'grain', 'edge'];
    for (const [i, field] of expected.entries()) {
      await expect(page.getByLabel(fill(p.columnSelect, { n: i + 1 }))).toHaveAttribute(
        'data-value',
        field,
      );
    }
    await expect(page.getByText(p.source.header)).toBeVisible();

    // The bad row is highlighted with a Turkish message; the others are fine.
    const preview = page.getByRole('table', { name: p.preview });
    const bad = preview.locator('tr[data-invalid="true"]');
    await expect(bad).toHaveCount(1);
    await expect(bad).toContainText('Arkalık');
    await expect(bad).toContainText(fill(p.errors.INVALID_NUMBER, { field: p.fields.w }));
    await expect(
      page.getByText(fill(p.summary, { valid: 3, invalid: 1, lines: '' }).split(' (')[0] as string),
    ).toBeVisible();

    // Nothing is applied before "Uygula".
    await expect(page.getByText(t.empty)).toBeVisible();

    // Change the mapping by hand: the edge band column is not used.
    await pickOption(page.getByLabel(fill(p.columnSelect, { n: 6 })), p.fields.ignore);
    await expect(page.getByText(p.source.manual)).toBeVisible();
    await page.screenshot({ path: '__screenshots__/t011-yapistir-onizleme.png', fullPage: true });

    await page.getByRole('button', { name: fill(p.applyCount, { count: 3 }) }).click();
    await expect(page.getByLabel(p.textLabel)).toHaveCount(0);
    // T246: a toast with a Geri al action, not a banner.
    await expect(page.getByText(fill(p.applied, { count: 3 }))).toBeVisible();

    await expect(cell(page, 1, t.columns.name)).toHaveValue('Kapak');
    await expect(cell(page, 1, t.columns.w)).toHaveValue('396,5');
    await expect(cell(page, 1, t.columns.h)).toHaveValue('716');
    await expect(cell(page, 1, t.columns.qty)).toHaveValue('4');
    await expect(cell(page, 1, t.columns.grain)).toBeChecked();
    await expect(page.getByLabel(fill(t.edgeLabel, { n: 1, edge: t.edge.top }))).toHaveValue('0');
    await expect(cell(page, 2, t.columns.name)).toHaveValue('Raf');
    await expect(cell(page, 3, t.columns.name)).toHaveValue('Çekmece önü');
    await expect(cell(page, 3, t.columns.qty)).toHaveValue('1');
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(t.count, { rows: 3, pieces: 7 }),
    );
    await page.screenshot({ path: '__screenshots__/t011-kesim-listesi.png', fullPage: true });

    // One undo removes the whole import; redo brings it back.
    await page.getByTestId('wizard-undo').click();
    await expect(page.getByText(t.empty)).toBeVisible();
    await page.getByRole('button', { name: t.redo }).click();
    await expect(cell(page, 3, t.columns.name)).toHaveValue('Çekmece önü');

    // Keyboard shortcut outside the inputs.
    await page.getByRole('heading', { level: 1 }).click();
    await page.keyboard.press('Control+Z');
    await expect(page.getByText(t.empty)).toBeVisible();
    await page.keyboard.press('Control+Y');
    await expect(cell(page, 1, t.columns.name)).toHaveValue('Kapak');
    expect(problems).toEqual([]);
  });

  test('ambiguous unit: asks mm or cm, cm multiplies by 10 only when chosen', async ({ page }) => {
    await page.goto(URL);
    const area = await openPaste(page);
    await area.fill('Kapak\t39,6\t71,6\t2\nRaf\t56,4\t30\t1');
    await expect(page.getByRole('group', { name: p.unit.question })).toBeVisible();
    // Uygula is disabled until a unit is chosen, and the reason is shown next to it.
    const apply = page.getByRole('button', { name: fill(p.applyCount, { count: 2 }) });
    await expect(apply).toBeDisabled();
    await expect(page.getByText(p.unit.required)).toBeVisible();
    await expect(page.getByText(t.empty)).toBeVisible();
    await page.screenshot({ path: '__screenshots__/t011-birim-sorusu.png', fullPage: true });

    await page.getByLabel(p.unit.cm).check();
    await expect(page.getByText(p.unit.required)).toHaveCount(0);
    await apply.click();
    await expect(cell(page, 1, t.columns.w)).toHaveValue('396');
    await expect(cell(page, 1, t.columns.h)).toHaveValue('716');
    await expect(cell(page, 2, t.columns.w)).toHaveValue('564');
  });

  test('cancel applies nothing', async ({ page }) => {
    await page.goto(URL);
    const area = await openPaste(page);
    await area.fill(SAMPLE_TSV);
    await page.getByRole('button', { name: p.cancel }).click();
    await expect(page.getByText(t.empty)).toBeVisible();
    await expect(page.getByTestId('wizard-undo')).toBeDisabled();
  });

  test('grid editing: add, edit with Enter, invalid value, duplicate, remove, undo', async ({
    page,
  }) => {
    await page.goto(URL);
    await page.getByRole('button', { name: t.addRow }).click();
    const name = cell(page, 1, t.columns.name);
    await expect(name).toBeFocused();
    await expect(name).toHaveValue(fill(t.defaultName, { n: 1 }));

    await name.fill('Yan dikme');
    await page.keyboard.press('Tab');
    const w = cell(page, 1, t.columns.w);
    await expect(w).toBeFocused();
    await w.fill('300,5');
    // Tab commits and moves right (T118: Enter on the last row would add a new row).
    await w.press('Tab');
    await expect(w).toHaveValue('300,5');

    // Invalid value: Turkish error, nothing changed, Esc restores.
    const h = cell(page, 1, t.columns.h);
    await h.fill('0');
    await h.press('Enter');
    await expect(h).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText(t.errors.positive)).toBeVisible();
    await h.press('Escape');
    await expect(h).toHaveValue('100');
    await expect(h).not.toHaveAttribute('aria-invalid', 'true');

    // T119: row actions live in the row menu.
    await page.getByRole('button', { name: fill(t.rowMenu.label, { n: 1 }) }).click();
    await page.getByRole('menuitem', { name: t.rowMenu.duplicate }).click();
    await expect(cell(page, 2, t.columns.name)).toHaveValue('Yan dikme');
    await expect(cell(page, 2, t.columns.w)).toHaveValue('300,5');

    await page.getByRole('button', { name: fill(t.rowMenu.label, { n: 1 }) }).click();
    await page.getByRole('menuitem', { name: t.rowMenu.remove }).click();
    await expect(cell(page, 2, t.columns.name)).toHaveCount(0);

    // Undo: remove, duplicate, width, name, add — one step each.
    const undo = page.getByTestId('wizard-undo');
    await undo.click();
    await expect(cell(page, 2, t.columns.name)).toHaveValue('Yan dikme');
    await undo.click();
    await expect(cell(page, 2, t.columns.name)).toHaveCount(0);
    await undo.click();
    await expect(w).toHaveValue('100');
    await undo.click();
    await expect(name).toHaveValue(fill(t.defaultName, { n: 1 }));
    await undo.click();
    await expect(page.getByText(t.empty)).toBeVisible();
    await expect(undo).toBeDisabled();
  });

  test('390 px: no page-level horizontal scroll; tables scroll in their own box', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(URL);
    const area = await openPaste(page);
    await area.fill(SAMPLE_TSV);
    const overflow = () =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.screenshot({ path: '__screenshots__/t011-mobil-yapistir.png', fullPage: true });
    await page.getByRole('button', { name: fill(p.applyCount, { count: 3 }) }).click();
    await expect(cell(page, 1, t.columns.name)).toHaveValue('Kapak');
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.screenshot({ path: '__screenshots__/t011-mobil-liste.png', fullPage: true });
  });
});
