import { expect, test, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
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

async function size(page: Page) {
  const text = (await page.getByTestId('editor-size').textContent()) ?? '';
  const m = /([\d.,]+)\s*×\s*([\d.,]+)/.exec(text);
  return { w: trNum(m?.[1] ?? 'NaN'), h: trNum(m?.[2] ?? 'NaN') };
}

async function position(page: Page) {
  const text = (await page.getByTestId('editor-position').textContent()) ?? '';
  const m = /X\s*(-?[\d.,]+)\s*·\s*Y\s*(-?[\d.,]+)/.exec(text);
  return { x: trNum(m?.[1] ?? 'NaN'), y: trNum(m?.[2] ?? 'NaN') };
}

async function view(canvas: Locator) {
  const [scale = 0, x = 0, y = 0] = ((await canvas.getAttribute('data-view')) ?? '')
    .split(',')
    .map(Number);
  return { scale, x, y };
}

const partRows = (page: Page) => page.getByTestId('editor-part-list').getByRole('button');

test.describe('T129 arc tool and segment bend', () => {
  test('arc by typed chord and R, closed with a line: exact radius from the size', async ({
    page,
  }) => {
    const canvas = await openBoard(page);
    const b = await canvas.boundingBox();
    if (!b) throw new Error('no canvas');
    await page.keyboard.press('a');
    await expect(page.getByTestId('editor-tool-arc')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('editor-hint')).toHaveText(tr.editor.draw.hints.arcStart);
    await page.mouse.click(b.x + b.width * 0.5, b.y + b.height * 0.8);
    // end point: chord 600 mm along +X
    await page.keyboard.type('600');
    await page.keyboard.press('Tab');
    await page.keyboard.type('0');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('editor-hint')).toHaveText(tr.editor.draw.hints.arcBend);
    await expect(page.getByTestId('editor-input-r')).toBeVisible();
    await page.keyboard.type('400');
    await page.keyboard.press('Enter');
    // close with the line tool: back along the chord
    await page.keyboard.press('l');
    await page.keyboard.type('600');
    await page.keyboard.press('Tab');
    await page.keyboard.type('180');
    await page.keyboard.press('Enter');
    await expect(partRows(page)).toHaveCount(6);
    const s = await size(page);
    expect(s.w).toBe(600);
    // sagitta of a 600 mm chord on R 400 = 400 − √(400² − 300²) ≈ 135,4
    expect(s.h).toBeCloseTo(400 - Math.sqrt(400 ** 2 - 300 ** 2), 1);
  });

  test('dragging the bend handle of a selected rectangle bends that edge; undo', async ({
    page,
  }) => {
    const canvas = await openBoard(page);
    await page.getByTestId('editor-part-list').getByRole('button').first().click();
    const s0 = await size(page);
    const p0 = await position(page);
    const v = await view(canvas);
    const b = await canvas.boundingBox();
    if (!b) throw new Error('no canvas');
    // bottom edge middle, in screen pixels
    const hx = b.x + (p0.x + s0.w / 2) * v.scale + v.x;
    const hy = b.y + v.y - p0.y * v.scale;
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.mouse.move(hx, hy + 15, { steps: 3 });
    await page.mouse.move(hx, hy + 30, { steps: 3 });
    await expect(page.getByTestId('editor-hint')).toHaveText(tr.editor.draw.hints.bend);
    await expect(page.getByTestId('editor-input-r')).toBeVisible();
    await page.mouse.up();
    await expect(page.getByTestId('editor-inspector')).toContainText(
      tr.editor.inspector.kind.freeform,
    );
    const s1 = await size(page);
    expect(s1.w).toBe(s0.w);
    expect(s1.h).toBeCloseTo(s0.h + 30 / v.scale, 0);
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('editor-inspector')).toContainText(tr.editor.inspector.kind.rect);
  });
});
