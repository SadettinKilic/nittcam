import { expect, test, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { KITCHEN, openNewProject, paste } from './wizard-helpers';

/** Opens a new project with the kitchen cut list and switches the Parts step to "Çizim". */
async function openBoard(page: Page): Promise<Locator> {
  await openNewProject(page, 'parcalar');
  await paste(page, KITCHEN, 5);
  await page.getByTestId('parts-view-drawing').click();
  const canvas = page.getByTestId('editor-canvas');
  await expect(canvas).toHaveAttribute('data-view', /\d/);
  return canvas;
}

async function view(canvas: Locator) {
  const v = (await canvas.getAttribute('data-view')) ?? '';
  const [scale = 0, x = 0, y = 0] = v.split(',').map(Number);
  return { scale, x, y };
}

/** Cursor read-out in the status bar as numbers (Turkish decimal comma). */
async function cursor(page: Page) {
  const text = (await page.getByTestId('editor-cursor').textContent()) ?? '';
  const num = (re: RegExp) =>
    Number((re.exec(text)?.[1] ?? 'NaN').replace(/\./g, '').replace(',', '.'));
  return { x: num(/X\s+(-?[\d.,]+)/), y: num(/Y\s+(-?[\d.,]+)/) };
}

test.describe('T124 drawing board', () => {
  test('Çizim tab shows the cut list parts on the board, with the URL kept', async ({ page }) => {
    const canvas = await openBoard(page);
    await expect(page).toHaveURL(/gorunum=cizim/);
    await expect(canvas).toHaveAttribute('aria-label', /5 parça/);
    await expect(page.getByTestId('editor-part-list').getByRole('button')).toHaveCount(5);
    await expect(page.getByTestId('editor-status')).toContainText(tr.editor.status.units);
    await page.getByTestId('parts-view-list').click();
    await expect(page).not.toHaveURL(/gorunum=cizim/);
    await expect(canvas).toHaveCount(0);
  });

  test('cursor coordinates match the view at three zoom levels (Y up)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const canvas = await openBoard(page);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('no canvas box');
    for (const zoomSteps of [0, 3, -2]) {
      const key = zoomSteps > 0 ? '+' : '-';
      for (let i = 0; i < Math.abs(zoomSteps); i += 1) await page.keyboard.press(key);
      const v = await view(canvas);
      const sx = box.width / 2;
      const sy = box.height / 2;
      await page.mouse.move(box.x + sx, box.y + sy);
      await page.mouse.move(box.x + sx + 1, box.y + sy + 1);
      const c = await cursor(page);
      expect(c.x).toBeCloseTo((sx + 1 - v.x) / v.scale, 0);
      expect(c.y).toBeCloseTo((v.y - (sy + 1)) / v.scale, 0);
      // Moving up on the screen increases board Y.
      await page.mouse.move(box.x + sx + 1, box.y + sy - 99);
      const up = await cursor(page);
      expect(up.y - c.y).toBeCloseTo(100 / v.scale, 0);
    }
  });

  test('wheel zooms at the cursor; pan tool and middle mouse pan; F fits', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const canvas = await openBoard(page);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('no canvas box');
    const start = await view(canvas);
    const at = { x: box.x + 200, y: box.y + 300 };
    await page.mouse.move(at.x, at.y);
    const before = await cursor(page);
    await page.mouse.wheel(0, -300);
    await expect.poll(async () => (await view(canvas)).scale).toBeGreaterThan(start.scale);
    await page.mouse.move(at.x + 1, at.y);
    await page.mouse.move(at.x, at.y);
    const after = await cursor(page);
    expect(after.x).toBeCloseTo(before.x, 0);
    expect(after.y).toBeCloseTo(before.y, 0);

    await page.getByTestId('editor-tool-pan').click();
    const v1 = await view(canvas);
    await page.mouse.move(box.x + 300, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 360, box.y + 340, { steps: 4 });
    await page.mouse.up();
    const v2 = await view(canvas);
    expect(v2.x - v1.x).toBeCloseTo(60, 0);
    expect(v2.y - v1.y).toBeCloseTo(40, 0);

    await page.getByTestId('editor-tool-select').click();
    await page.mouse.move(box.x + 300, box.y + 300);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(box.x + 280, box.y + 300, { steps: 3 });
    await page.mouse.up({ button: 'middle' });
    // Chromium may swallow the first move after a middle press; the pan direction is what counts.
    expect((await view(canvas)).x - v2.x).toBeLessThan(-10);

    await canvas.focus();
    await page.keyboard.press('f');
    await expect.poll(async () => (await view(canvas)).scale).toBeCloseTo(start.scale, 4);
  });

  test('pinch with two touch points zooms the board, not the page', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const canvas = await openBoard(page);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('no canvas box');
    const start = await view(canvas);
    const scrollY = await page.evaluate(() => window.scrollY);
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    // Two pointers (touch) moving apart.
    await canvas.dispatchEvent('pointerdown', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: cx - 20,
      clientY: cy,
      button: 0,
      isPrimary: true,
    });
    await canvas.dispatchEvent('pointerdown', {
      pointerId: 2,
      pointerType: 'touch',
      clientX: cx + 20,
      clientY: cy,
      button: 0,
    });
    for (let d = 30; d <= 80; d += 10) {
      await canvas.dispatchEvent('pointermove', {
        pointerId: 1,
        pointerType: 'touch',
        clientX: cx - d,
        clientY: cy,
      });
      await canvas.dispatchEvent('pointermove', {
        pointerId: 2,
        pointerType: 'touch',
        clientX: cx + d,
        clientY: cy,
      });
    }
    await canvas.dispatchEvent('pointerup', {
      pointerId: 1,
      pointerType: 'touch',
      clientX: cx - 80,
      clientY: cy,
    });
    await canvas.dispatchEvent('pointerup', {
      pointerId: 2,
      pointerType: 'touch',
      clientX: cx + 80,
      clientY: cy,
    });
    const end = await view(canvas);
    expect(end.scale / start.scale).toBeGreaterThan(3);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
  });
});
