import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };

/** T011b tester: U/K paste → cells, undo steps, Enter down, 320/390 px, console, tr.json strings. */

const t = tr.cutList;
const p = t.paste;
const URL = '/projeler/yeni/parcalar';
type Edge = keyof typeof t.edge;

const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
const edge = (page: Page, n: number, e: Edge) =>
  page.getByLabel(fill(t.edgeLabel, { n, edge: t.edge[e] }), { exact: true });
const cell = (page: Page, n: number, column: string) =>
  page.getByLabel(fill(t.cellLabel, { n, column }), { exact: true });
const overflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}

// All four U/K columns: landscape, portrait, square.
const TSV = [
  'Parça\tEn\tBoy\tAdet\tUzun1\tUzun2\tKısa1\tKısa2',
  'Kapak\t716\t396\t2\t0,8\t0,4\t1\t2',
  'Yan\t400\t720\t2\t0,8\t0,4\t1\t2',
  'Kare\t500\t500\t1\t0,8\t0,4\t1\t2',
].join('\n');

async function pasteAndApply(page: Page, text: string, count: number) {
  await page.getByRole('button', { name: t.pasteOpen }).click();
  await page.getByLabel(p.textLabel).fill(text);
  await page.getByRole('button', { name: fill(p.applyCount, { count }) }).click();
  await expect(page.getByLabel(p.textLabel)).toHaveCount(0);
}

async function expectEdges(page: Page, n: number, v: Record<Edge, string>) {
  for (const k of Object.keys(v) as Edge[]) await expect(edge(page, n, k)).toHaveValue(v[k]);
}

test.describe('T011b edge band (tester)', () => {
  // T118: the four band columns show on a wide grid; narrower grids use the Bant popover.
  test.use({ viewport: { width: 1600, height: 900 } });

  test('U1/U2/K1/K2 on landscape, portrait and square rows fill the right grid cells', async ({
    page,
  }) => {
    const problems = watchConsole(page);
    await page.goto(URL);
    await pasteAndApply(page, TSV, 3);
    await expectEdges(page, 1, { top: '0,4', right: '2', bottom: '0,8', left: '1' });
    await expectEdges(page, 2, { top: '2', right: '0,4', bottom: '1', left: '0,8' });
    await expectEdges(page, 3, { top: '0,4', right: '2', bottom: '0,8', left: '1' });
    expect(problems).toEqual([]);
  });

  test('named + U/K on the same edge: warning, named wins; single + per-edge: conflict warning', async ({
    page,
  }) => {
    await page.goto(URL);
    await page.getByRole('button', { name: t.pasteOpen }).click();
    await page.getByLabel(p.textLabel).fill('Ad\tEn\tBoy\tU1\tAlt\nA\t700\t300\t1\t0,5');
    await expect(page.getByText(p.warnings.EDGE_BAND_MIXED)).toBeVisible();
    await page.getByRole('button', { name: fill(p.applyCount, { count: 1 }) }).click();
    await expectEdges(page, 1, { top: '0', right: '0', bottom: '0,5', left: '0' });

    await page.getByRole('button', { name: t.pasteOpen }).click();
    await page.getByLabel(p.textLabel).fill('Ad\tEn\tBoy\tBant\tK1\nB\t700\t300\t3\t2');
    await expect(page.getByText(p.warnings.EDGE_BAND_CONFLICT)).toBeVisible();
  });

  test('no-band marks (-, –, yok, YOK) apply; x / 1mm / -1 are Turkish row errors', async ({
    page,
  }) => {
    await page.goto(URL);
    await page.getByRole('button', { name: t.pasteOpen }).click();
    const marks = ['-', '–', 'yok', 'YOK', 'x', '1mm', '-1', '1'];
    const lines = marks.map((m, i) => `P${i + 1}\t500\t300\t${m}`);
    await page.getByLabel(p.textLabel).fill(['Ad\tEn\tBoy\tÜst', ...lines].join('\n'));
    const bad = page.getByRole('table', { name: p.preview }).locator('tr[data-invalid="true"]');
    await expect(bad).toHaveCount(3);
    await expect(bad.first()).toContainText(
      fill(p.errors.INVALID_EDGE_BAND, { field: p.fields.edgeTop }),
    );
    await page.getByRole('button', { name: fill(p.applyCount, { count: 5 }) }).click();
    for (const n of [1, 2, 3, 4]) await expect(edge(page, n, 'top')).toHaveValue('0');
    await expect(edge(page, 5, 'top')).toHaveValue('1');
  });

  test('one edit = one undo step; the same value adds none; Enter moves down the column', async ({
    page,
  }) => {
    await page.goto(URL);
    await pasteAndApply(page, TSV, 3);
    const undo = page.getByTestId('wizard-undo');

    // Same value typed again: no step; Enter moves down the same column.
    await edge(page, 1, 'top').fill('0,4');
    await edge(page, 1, 'top').press('Enter');
    await expect(edge(page, 2, 'top')).toBeFocused();
    await edge(page, 2, 'right').fill('0,4');
    await edge(page, 2, 'right').press('Enter');
    await expect(edge(page, 3, 'right')).toBeFocused();

    // A real edit on row 3 bottom: exactly one step.
    await edge(page, 3, 'bottom').fill('1,2');
    // Tab, not Enter: Enter on the last row adds a part (T118).
    await edge(page, 3, 'bottom').press('Tab');
    await expectEdges(page, 3, { top: '0,4', right: '2', bottom: '1,2', left: '1' });
    await undo.click();
    await expect(edge(page, 3, 'bottom')).toHaveValue('0,8');
    // The no-op edits left nothing behind: the next undo is the import itself.
    await expect(cell(page, 3, t.columns.name)).toHaveValue('Kare');
    await undo.click();
    await expect(page.getByText(t.empty)).toBeVisible();
  });

  test('swapping w and h in the grid keeps the stored band per edge', async ({ page }) => {
    await page.goto(URL);
    await pasteAndApply(page, TSV, 3);
    await cell(page, 1, t.columns.w).fill('396');
    await cell(page, 1, t.columns.w).press('Enter');
    await cell(page, 1, t.columns.h).fill('716');
    await cell(page, 1, t.columns.h).press('Enter');
    // Edges are stored per edge after import; swapping the sizes does not re-map them.
    await expectEdges(page, 1, { top: '0,4', right: '2', bottom: '0,8', left: '1' });
  });

  for (const width of [320, 390]) {
    test(`${width} px: no page-level horizontal scroll, no console errors, band inputs usable`, async ({
      page,
    }) => {
      const problems = watchConsole(page);
      await page.setViewportSize({ width, height: 800 });
      await page.goto(URL);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      await pasteAndApply(page, TSV, 3);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      // T118: phone cards; the Bant cell opens the four band inputs.
      await page.getByTestId('band-cell-1').click();
      const right = edge(page, 1, 'right');
      await right.fill('3');
      await right.press('Enter');
      await expect(right).toHaveValue('3');
      expect((await right.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(40);
      expect(await overflow(page)).toBeLessThanOrEqual(0);
      expect(problems).toEqual([]);
    });
  }

  test('strings come from tr.json: edge headers, labels', async ({ page }) => {
    await page.goto(URL);
    await pasteAndApply(page, TSV, 3);
    for (const k of ['top', 'bottom', 'left', 'right'] as const) {
      await expect(
        page.getByRole('columnheader', {
          name: fill(t.edgeHeader, { edge: t.edge[k] }),
          exact: true,
        }),
      ).toBeVisible();
    }
    await expect(edge(page, 1, 'top')).toBeVisible();
  });
});
