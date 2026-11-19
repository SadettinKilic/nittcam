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
