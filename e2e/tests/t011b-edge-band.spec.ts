import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { optionLabels } from './wizard-helpers';

/** T011b: edge band per edge (named + long/short columns), grid columns Üst/Alt/Sol/Sağ. */

const t = tr.cutList;
const p = t.paste;
const URL = '/projeler/yeni/parcalar';

type Edge = keyof typeof t.edge;

const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
const edge = (page: Page, n: number, e: Edge) =>
  page.getByLabel(fill(t.edgeLabel, { n, edge: t.edge[e] }), { exact: true });
const name = (page: Page, n: number) =>
  page.getByLabel(fill(t.cellLabel, { n, column: t.columns.name }), { exact: true });
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Landscape door (U1 → Alt, K2 → Sağ) and portrait side panel (U1 → Sol, K2 → Üst). */
const LONG_SHORT_TSV = [
  'Parça adı\tEn\tBoy\tAdet\tUzun1\tKısa2',
  'Kapak\t716\t396\t2\t0,8\t2',
  'Yan\t400\t720\t2\t1\t0,4',
].join('\n');

async function expectEdges(page: Page, n: number, values: Record<Edge, string>) {
  for (const e of Object.keys(values) as Edge[]) {
    await expect(edge(page, n, e)).toHaveValue(values[e]);
  }
}

async function pasteAndApply(page: Page, text: string, count: number) {
  await page.getByRole('button', { name: t.pasteOpen }).click();
  await page.getByLabel(p.textLabel).fill(text);
  await page.getByRole('button', { name: fill(p.applyCount, { count }) }).click();
  await expect(page.getByLabel(p.textLabel)).toHaveCount(0);
}

test.describe('T011b edge band per edge', () => {
  test('paste with Uzun1/Kısa2 → the right edges are filled by orientation', async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(e.message));
    await page.goto(URL);
    await page.getByRole('button', { name: t.pasteOpen }).click();
    await page.getByLabel(p.textLabel).fill(LONG_SHORT_TSV);

    // Auto mapping from the header; the dropdowns offer every per-edge target.
    const expected = ['name', 'w', 'h', 'qty', 'edgeLong1', 'edgeShort2'];
    for (const [i, field] of expected.entries()) {
      await expect(page.getByLabel(fill(p.columnSelect, { n: i + 1 }))).toHaveAttribute(
        'data-value',
        field,
      );
    }
    const options = await optionLabels(page.getByLabel(fill(p.columnSelect, { n: 5 })));
    for (const f of [
      'edge',
      'edgeTop',
      'edgeBottom',
      'edgeLeft',
      'edgeRight',
      'edgeLong1',
      'edgeLong2',
      'edgeShort1',
      'edgeShort2',
    ] as const) {
      expect(options.filter((o) => o === p.fields[f])).toHaveLength(1);
    }
    await expect(page.getByTestId('edge-help')).toHaveText(p.edgeHelp);
    await page.screenshot({ path: '__screenshots__/t011b-yapistir-uzun-kisa.png', fullPage: true });

    await page.getByRole('button', { name: fill(p.applyCount, { count: 2 }) }).click();
    await expect(name(page, 2)).toHaveValue('Yan');
    // Kapak 716 × 396 (w ≥ h): U1 → Alt, K2 → Sağ.
    await expectEdges(page, 1, { top: '0', bottom: '0,8', left: '0', right: '2' });
    // Yan 400 × 720 (w < h): U1 → Sol, K2 → Üst.
    await expectEdges(page, 2, { top: '0,4', bottom: '0', left: '1', right: '0' });

    // The grid has four band columns in the order Üst, Alt, Sol, Sağ.
    const headers = page.locator('thead th[data-testid^="edge-col-"]');
    await expect(headers).toHaveText([t.edge.top, t.edge.bottom, t.edge.left, t.edge.right]);
    await page.screenshot({ path: '__screenshots__/t011b-kesim-listesi-bant.png', fullPage: true });
    expect(problems).toEqual([]);
  });

  test('single + per-edge column: warning shown, per-edge wins', async ({ page }) => {
    await page.goto(URL);
    await page.getByRole('button', { name: t.pasteOpen }).click();
    await page.getByLabel(p.textLabel).fill('Ad\tEn\tBoy\tBant\tÜst bant\nKapak\t396\t716\t2\t0,8');
    await expect(page.getByText(p.warnings.EDGE_BAND_CONFLICT)).toBeVisible();
    await page.getByRole('button', { name: fill(p.applyCount, { count: 1 }) }).click();
    await expectEdges(page, 1, { top: '0,8', bottom: '0', left: '0', right: '0' });
  });

  test('invalid per-edge value → Turkish row error, row skipped', async ({ page }) => {
    await page.goto(URL);
    await page.getByRole('button', { name: t.pasteOpen }).click();
    await page.getByLabel(p.textLabel).fill('Ad\tEn\tBoy\tSol\nA\t500\t300\tvar\nB\t500\t300\t1');
    const bad = page.getByRole('table', { name: p.preview }).locator('tr[data-invalid="true"]');
    await expect(bad).toHaveCount(1);
    await expect(bad).toContainText(fill(p.errors.INVALID_EDGE_BAND, { field: p.fields.edgeLeft }));
    await page.getByRole('button', { name: fill(p.applyCount, { count: 1 }) }).click();
    await expect(name(page, 1)).toHaveValue('B');
    await expectEdges(page, 1, { top: '0', bottom: '0', left: '1', right: '0' });
  });

  test('editing one edge is one undo step; an unchanged value adds none', async ({ page }) => {
    await page.goto(URL);
    await pasteAndApply(page, LONG_SHORT_TSV, 2);
    const undo = page.getByRole('button', { name: t.undo });
    const redo = page.getByRole('button', { name: t.redo });

    await edge(page, 1, 'left').fill('1,5');
    await page.keyboard.press('Enter');
    // Enter moves down the same edge column.
    await expect(edge(page, 2, 'left')).toBeFocused();
    await expectEdges(page, 1, { top: '0', bottom: '0,8', left: '1,5', right: '2' });

    // Re-typing the current value runs no command (no extra undo step).
    await edge(page, 1, 'right').fill('2');
    await page.keyboard.press('Enter');

    await undo.click();
    // Only the left edge went back; the import is still there.
    await expectEdges(page, 1, { top: '0', bottom: '0,8', left: '0', right: '2' });
    await expect(name(page, 2)).toHaveValue('Yan');
    await redo.click();
    await expect(edge(page, 1, 'left')).toHaveValue('1,5');

    // Two undos: the edit, then the whole import.
    await undo.click();
    await undo.click();
    await expect(page.getByText(t.empty)).toBeVisible();

    // Invalid input shows the Turkish error and runs nothing.
    await redo.click();
    await edge(page, 1, 'top').fill('abc');
    await page.keyboard.press('Enter');
    await expect(page.getByText(t.errors.band)).toBeVisible();
    await expect(edge(page, 1, 'top')).toHaveAttribute('aria-invalid', 'true');
  });

  test('390 px: no page-level horizontal scroll; the band columns stay usable', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(URL);
    await page.getByRole('button', { name: t.pasteOpen }).click();
    await page.getByLabel(p.textLabel).fill(LONG_SHORT_TSV);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.getByRole('button', { name: fill(p.applyCount, { count: 2 }) }).click();
    await expect(name(page, 1)).toHaveValue('Kapak');
    expect(await overflow(page)).toBeLessThanOrEqual(0);

    // The rightmost band input scrolls into view inside the table box and can be edited.
    const right = edge(page, 2, 'right');
    await right.scrollIntoViewIfNeeded();
    await expect(right).toBeInViewport();
    await right.fill('1');
    await page.keyboard.press('Enter');
    await expect(right).toHaveValue('1');
    const box = await right.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(40);
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: '__screenshots__/t011b-mobil-bant.png', fullPage: true });
  });
});
