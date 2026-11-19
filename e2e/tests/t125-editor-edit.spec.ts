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

async function view(canvas: Locator) {
  const [scale = 0, x = 0, y = 0] = ((await canvas.getAttribute('data-view')) ?? '')
    .split(',')
    .map(Number);
  return { scale, x, y };
}

async function selectByName(page: Page, name: string) {
  await page.getByTestId('editor-part-list').getByRole('button', { name, exact: true }).click();
  // Keys go to the board, not the list button.
  await page.getByTestId('editor-canvas').focus();
}

const undo = (page: Page) => page.keyboard.press('Control+z');

test.describe('T125 selection and edit commands', () => {
  test('arrow keys move 1 mm (Shift 10 mm) and Ctrl+Z undoes', async ({ page }) => {
    await openBoard(page);
    await selectByName(page, 'Yan');
    const p0 = await position(page);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowUp');
    await expect.poll(() => position(page)).toEqual({ x: p0.x + 2, y: p0.y + 10 });
    await undo(page);
    await expect.poll(() => position(page)).toEqual({ x: p0.x + 2, y: p0.y });
    await undo(page);
    await undo(page);
    await expect.poll(() => position(page)).toEqual(p0);
  });

  test('drag moves the selection by the pointer distance; undo restores', async ({ page }) => {
    const canvas = await openBoard(page);
    await selectByName(page, 'Kapak');
    const p0 = await position(page);
    const s0 = await size(page);
    const v = await view(canvas);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas');
    const cx = box.x + v.x + (p0.x + s0.w / 2) * v.scale;
    const cy = box.y + v.y - (p0.y + s0.h / 2) * v.scale;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 50, cy - 30, { steps: 5 });
    await page.mouse.up();
    const p1 = await position(page);
    // Snapping (T126) may pull the drop onto a nearby point; the move follows the pointer closely.
    expect(Math.abs(p1.x - (p0.x + 50 / v.scale))).toBeLessThan(12 / v.scale + 1);
    expect(Math.abs(p1.y - (p0.y + 30 / v.scale))).toBeLessThan(12 / v.scale + 1);
    await undo(page);
    await expect.poll(() => position(page)).toEqual(p0);
  });

  test('Ctrl+C / Ctrl+V paste copies offset by 20 mm each time; Ctrl+D duplicates', async ({
    page,
  }) => {
    await openBoard(page);
    const list = page.getByTestId('editor-part-list').getByRole('button');
    await selectByName(page, 'Raf');
    const p0 = await position(page);
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await expect(list).toHaveCount(6);
    await expect.poll(() => position(page)).toEqual({ x: p0.x + 20, y: p0.y - 20 });
    await page.keyboard.press('Control+v');
    await expect(list).toHaveCount(7);
    await expect.poll(() => position(page)).toEqual({ x: p0.x + 40, y: p0.y - 40 });
    await page.keyboard.press('Control+d');
    await expect(list).toHaveCount(8);
    await expect.poll(() => position(page)).toEqual({ x: p0.x + 60, y: p0.y - 60 });
    await undo(page);
    await expect(list).toHaveCount(7);
  });

  test('rotate swaps the size about the centre; mirror keeps it; Delete removes; undo', async ({
    page,
  }) => {
    await openBoard(page);
    const list = page.getByTestId('editor-part-list').getByRole('button');
    await selectByName(page, 'Çekmece önü');
    const s0 = await size(page);
    await page.keyboard.press('Shift+R');
    await expect.poll(() => size(page)).toEqual({ w: s0.h, h: s0.w });
    await page.getByRole('button', { name: 'Yatay aynala' }).click();
    await expect.poll(() => size(page)).toEqual({ w: s0.h, h: s0.w });
    await page.getByTestId('editor-canvas').focus();
    await page.keyboard.press('Delete');
    await expect(list).toHaveCount(4);
    await undo(page);
    await expect(list).toHaveCount(5);
  });

  test('click, Shift-click and box select', async ({ page }) => {
    const canvas = await openBoard(page);
    await selectByName(page, 'Yan');
    await page
      .getByTestId('editor-part-list')
      .getByRole('button', { name: 'Taban' })
      .click({ modifiers: ['Shift'] });
    await expect(canvas).toHaveAttribute('data-selection', /,/);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas');
    // B11 (T256): toasts sit above the footer now, i.e. over the canvas's bottom-right corner
    // where this drag starts; let the paste toast go first.
    await page.mouse.move(0, 0);
    await page.locator('[data-sonner-toast]').first().waitFor({ state: 'detached' });
    await page.mouse.move(box.x + box.width - 6, box.y + box.height - 6);
    await page.mouse.down();
    await page.mouse.move(box.x + 30, box.y + 30, { steps: 6 });
    await page.mouse.up();
    await expect
      .poll(async () => ((await canvas.getAttribute('data-selection')) ?? '').split(',').length)
      .toBe(5);
    await page.keyboard.press('Escape');
    await expect(canvas).toHaveAttribute('data-selection', '');
  });
});
