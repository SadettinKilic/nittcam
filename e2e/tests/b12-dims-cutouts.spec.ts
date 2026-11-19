import { expect, test, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { KITCHEN, openNewProject, paste } from './wizard-helpers';

// B12: T133 dimensions, T134 inner contours, T135 cut list ↔ editor sync, T261 rider.

const trNum = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

async function openBoard(page: Page, width = 1440, height = 900): Promise<Locator> {
  await page.setViewportSize({ width, height });
  await openNewProject(page, 'parcalar');
  await paste(page, KITCHEN, 5);
  await page.getByTestId('parts-view-drawing').click();
  const canvas = page.getByTestId('editor-canvas');
  await expect(canvas).toHaveAttribute('data-view', /\d/);
  return canvas;
}

async function position(page: Page) {
  const text = (await page.getByTestId('editor-position').textContent()) ?? '';
  const m = /X\s*(-?[\d.,]+)\s*·\s*Y\s*(-?[\d.,]+)/.exec(text);
  return { x: trNum(m?.[1] ?? 'NaN'), y: trNum(m?.[2] ?? 'NaN') };
}

async function size(page: Page) {
  const text = (await page.getByTestId('editor-size').textContent()) ?? '';
  const m = /([\d.,]+)\s*×\s*([\d.,]+)/.exec(text);
  return { w: trNum(m?.[1] ?? 'NaN'), h: trNum(m?.[2] ?? 'NaN') };
}

/** Screen point of a board point (mm) on the canvas. */
async function screen(canvas: Locator, p: { x: number; y: number }) {
  const [scale = 0, x = 0, y = 0] = ((await canvas.getAttribute('data-view')) ?? '')
    .split(',')
    .map(Number);
  const b = await canvas.boundingBox();
  if (!b) throw new Error('no canvas');
  return { x: b.x + p.x * scale + x, y: b.y + y - p.y * scale };
}

test.describe('T133 dimensions', () => {
  test('dimension tool: two corner clicks add a persistent dimension; removable; undo', async ({
    page,
  }) => {
    const canvas = await openBoard(page);
    await page.getByTestId('editor-part-list').getByRole('button').first().click();
    const p0 = await position(page);
    const s0 = await size(page);
    await page.getByTestId('editor-tool-dim').click();
    await expect(page.getByTestId('editor-tool-dim')).toHaveAttribute('aria-pressed', 'true');
    const a = await screen(canvas, p0);
    const b = await screen(canvas, { x: p0.x + s0.w, y: p0.y });
    await page.mouse.move(a.x, a.y);
    await page.mouse.click(a.x, a.y);
    await page.mouse.move(b.x, b.y);
    await page.mouse.click(b.x, b.y);
    // Back to Seç: the part's Ölçüler group lists the new dimension (snapped to the corners).
    await page.keyboard.press('v');
    await expect(page.getByTestId('prop-dim')).toHaveCount(1);
    await expect(page.getByTestId('prop-dim')).toContainText(String(s0.w));
    // The cut list size did not change: a dimension is not geometry.
    await expect(page.getByTestId('editor-size')).toHaveText(/560\s*×\s*720/);
    await page.getByTestId('prop-dim-remove').click();
    await expect(page.getByTestId('prop-dim')).toHaveCount(0);
    await page.getByTestId('editor-canvas').focus();
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('prop-dim')).toHaveCount(1);
  });

  test('a dimension outside every part is refused with a Turkish notice', async ({ page }) => {
    const canvas = await openBoard(page);
    await page.keyboard.press('d');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('no canvas');
    // Far bottom-right corner of the canvas: empty board.
    await page.mouse.click(box.x + box.width - 40, box.y + box.height - 40);
    await page.mouse.click(box.x + box.width - 140, box.y + box.height - 40);
    await expect(page.getByText(tr.editor.dim.noPart)).toBeVisible();
  });
});

test.describe('T134 inner contours', () => {
  test('a rectangle drawn inside a part asks "iç kesim olarak ekle?" and becomes its cut-out', async ({
    page,
  }) => {
    const canvas = await openBoard(page);
    await page.getByTestId('editor-part-list').getByRole('button').first().click();
    const p0 = await position(page);
    const partsBefore = await page.getByTestId('editor-part-list').getByRole('button').count();
    await page.keyboard.press('r');
    const a = await screen(canvas, { x: p0.x + 150, y: p0.y + 200 });
    const b = await screen(canvas, { x: p0.x + 400, y: p0.y + 500 });
    // Alt = free points (no grid snap).
    await page.keyboard.down('Alt');
    await page.mouse.click(a.x, a.y);
    await page.mouse.click(b.x, b.y);
    await page.keyboard.up('Alt');
    const prompt = page.getByTestId('inner-prompt');
    await expect(prompt).toBeVisible();
    await expect(prompt).toContainText(tr.editor.inner.title);
    await page.getByTestId('inner-prompt-inner').click();
    await expect(prompt).toHaveCount(0);
    await page.keyboard.press('v');
    // No new part; the first part now has one cut-out of the drawn size.
    await expect(page.getByTestId('editor-part-list').getByRole('button')).toHaveCount(partsBefore);
    await expect(page.getByTestId('prop-inner')).toHaveCount(1);
    // Free points: the drawn size within a pixel's worth of millimetres.
    const text = ((await page.getByTestId('prop-inner').textContent()) ?? '').replace(
      tr.editor.inspector.innerN.replace('{n}', '1'),
      '',
    );
    const m = /([\d.,]+)\s*×\s*([\d.,]+)/.exec(text);
    expect(Math.abs(trNum(m?.[1] ?? 'NaN') - 250)).toBeLessThan(5);
    expect(Math.abs(trNum(m?.[2] ?? 'NaN') - 300)).toBeLessThan(5);
    await expect(page.getByTestId('prop-op-inners')).toHaveText('1');
    // Removable, one undo step.
    await page.getByTestId('prop-inner-remove').click();
    await expect(page.getByTestId('prop-inner')).toHaveCount(0);
    await page.getByTestId('editor-canvas').focus();
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('prop-inner')).toHaveCount(1);
  });

  test('"Ayrı parça" adds a new part; a shape across the edge is a part without asking', async ({
    page,
  }) => {
    const canvas = await openBoard(page);
    await page.getByTestId('editor-part-list').getByRole('button').first().click();
    const p0 = await position(page);
    const list = page.getByTestId('editor-part-list').getByRole('button');
    const n = await list.count();
    await page.keyboard.press('r');
    let a = await screen(canvas, { x: p0.x + 150, y: p0.y + 200 });
    let b = await screen(canvas, { x: p0.x + 400, y: p0.y + 500 });
    await page.mouse.click(a.x, a.y);
    await page.mouse.click(b.x, b.y);
    await page.getByTestId('inner-prompt-part').click();
    await expect(list).toHaveCount(n + 1);
    // Across the left edge: not inside → no prompt.
    a = await screen(canvas, { x: p0.x - 100, y: p0.y + 50 });
    b = await screen(canvas, { x: p0.x + 100, y: p0.y + 150 });
    await page.mouse.click(a.x, a.y);
    await page.mouse.click(b.x, b.y);
    await expect(list).toHaveCount(n + 2);
    await expect(page.getByTestId('inner-prompt')).toHaveCount(0);
  });
});

test.describe('T135 cut list ↔ editor sync', () => {
  test('one selection for Liste and Çizim; search in the board list', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    // Select row 2 in the grid → the board shows it selected.
    await page.getByTestId('row-select-2').click();
    await page.getByTestId('parts-view-drawing').click();
    const list = page.getByTestId('editor-part-list').getByRole('button');
    await expect(list).toHaveCount(5);
    await expect(list.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('editor-properties')).toBeVisible();
    // Select row 4 on the board → the grid shows row 4 selected.
    await list.nth(3).click();
    await page.getByTestId('parts-view-list').click();
    await expect(page.getByTestId('row-select-4')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('row-select-2')).toHaveAttribute('aria-checked', 'false');
    // Search filters the board list only; row numbers stay.
    await page.getByTestId('parts-view-drawing').click();
    await page.getByTestId('editor-part-search').fill('kapak');
    await expect(list).toHaveCount(1);
    await expect(list.first()).toContainText('Kapak');
    await expect(list.first()).toContainText('3');
    await page.getByTestId('editor-part-search').fill('zzzz-yok');
    await expect(page.getByTestId('editor-part-search-empty')).toBeVisible();
  });

  test('a freeform part shows "Serbest" with read-only bounding-box W/H in the grid', async ({
    page,
  }) => {
    const canvas = await openBoard(page);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('no canvas');
    // A circle on empty board (bottom right) → freeform part.
    await page.keyboard.press('c');
    await page.keyboard.down('Alt');
    await page.mouse.click(box.x + box.width - 150, box.y + box.height - 120);
    await page.mouse.click(box.x + box.width - 110, box.y + box.height - 120);
    await page.keyboard.up('Alt');
    await expect(page.getByTestId('editor-part-list').getByRole('button')).toHaveCount(6);
    await page.getByTestId('parts-view-list').click();
    const w = page.getByTestId('cell-w-freeform');
    await expect(w).toHaveCount(1);
    await expect(w).toContainText(tr.cutList.freeform);
    await expect(page.getByTestId('cell-h-freeform')).toHaveText(/\d/);
    await expect(w.locator('input')).toHaveCount(0);
  });
});
