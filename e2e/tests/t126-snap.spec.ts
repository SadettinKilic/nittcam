import { expect, test, type Locator, type Page } from '@playwright/test';
import { KITCHEN, openNewProject, paste } from './wizard-helpers';

const trNum = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

async function openBoard(page: Page): Promise<Locator> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await paste(page, KITCHEN, 5);
  await page.getByTestId('parts-view-drawing').click();
  const canvas = page.getByTestId('editor-canvas');
  await expect(canvas).toHaveAttribute('data-view', /\d/);
  return canvas;
}

async function select(page: Page, name: string) {
  await page.getByTestId('editor-part-list').getByRole('button', { name, exact: true }).click();
}

/** Bottom-left corner and size of the selected part, from the inspector (board mm). */
async function readPart(page: Page) {
  const pos = (await page.getByTestId('editor-position').textContent()) ?? '';
  const size = (await page.getByTestId('editor-size').textContent()) ?? '';
  const p = /X\s*(-?[\d.,]+)\s*·\s*Y\s*(-?[\d.,]+)/.exec(pos);
  const s = /([\d.,]+)\s*×\s*([\d.,]+)/.exec(size);
  return {
    x: trNum(p?.[1] ?? 'NaN'),
    y: trNum(p?.[2] ?? 'NaN'),
    w: trNum(s?.[1] ?? 'NaN'),
    h: trNum(s?.[2] ?? 'NaN'),
  };
}

async function view(canvas: Locator) {
  const [scale = 0, x = 0, y = 0] = ((await canvas.getAttribute('data-view')) ?? '')
    .split(',')
    .map(Number);
  return { scale, x, y };
}

/**
 * Drags the selected part so its bottom-left corner lands a few pixels off `target` (board mm),
 * pressing just inside that corner so it is the snapping anchor.
 */
async function dragCornerNear(
  page: Page,
  canvas: Locator,
  part: { x: number; y: number },
  target: { x: number; y: number },
  opts: { alt?: boolean } = {},
) {
  const v = await view(canvas);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas');
  const sx = (x: number) => box.x + v.x + x * v.scale;
  const sy = (y: number) => box.y + v.y - y * v.scale;
  const from = { x: sx(part.x) + 6, y: sy(part.y) - 6 };
  const to = { x: sx(target.x) + 6 + 3, y: sy(target.y) - 6 - 2 };
  await page.mouse.move(from.x, from.y);
  if (opts.alt) await page.keyboard.down('Alt');
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  if (opts.alt) await page.keyboard.up('Alt');
  return v;
}

test.describe('T126 snapping in the editor', () => {
  test('a dragged corner lands exactly on another part’s corner (endpoint snap)', async ({
    page,
  }) => {
    const canvas = await openBoard(page);
    await select(page, 'Yan');
    const yan = await readPart(page);
    await select(page, 'Raf');
    const raf = await readPart(page);
    // Target: Yan's top-right corner.
    const target = { x: yan.x + yan.w, y: yan.y + yan.h };
    await dragCornerNear(page, canvas, raf, target);
    await expect.poll(() => readPart(page)).toEqual({ ...raf, x: target.x, y: target.y });
  });

  test('holding Alt moves freely (no snap)', async ({ page }) => {
    const canvas = await openBoard(page);
    await select(page, 'Yan');
    const yan = await readPart(page);
    await select(page, 'Raf');
    const raf = await readPart(page);
    const target = { x: yan.x + yan.w, y: yan.y + yan.h };
    await dragCornerNear(page, canvas, raf, target, { alt: true });
    const after = await readPart(page);
    expect(after.x === target.x && after.y === target.y).toBe(false);
  });

  test('snap kinds toggle in the status bar', async ({ page }) => {
    await openBoard(page);
    const menu = page.getByTestId('editor-snap-menu');
    await expect(menu).toContainText('6');
    await menu.click();
    await page.getByRole('checkbox', { name: 'Uç nokta' }).click();
    await expect(menu).toContainText('5');
  });
});
