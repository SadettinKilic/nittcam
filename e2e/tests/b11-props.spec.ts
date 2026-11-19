import { expect, test, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { KITCHEN, fill, openNewProject, paste, pickOption } from './wizard-helpers';

// B11: T130 properties panel, T254 board fit / focus ring.

const ins = tr.editor.inspector;
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

async function setField(page: Page, testId: string, value: string) {
  const input = page.getByTestId(testId);
  await input.click();
  await input.fill(value);
  await input.press('Enter');
}

test.describe('T130 properties panel', () => {
  test('rectangle W/H/R and qty: one undo step per edit, invalid values rejected', async ({
    page,
  }) => {
    await openBoard(page);
    await page.getByTestId('editor-part-list').getByRole('button').first().click();
    await expect(page.getByTestId('editor-properties')).toBeVisible();
    await expect(page.getByTestId('editor-size')).toHaveText(/560\s*×\s*720/);

    await setField(page, 'prop-w', '600');
    await expect(page.getByTestId('editor-size')).toHaveText(/600\s*×\s*720/);
    await setField(page, 'prop-h', '700');
    await expect(page.getByTestId('editor-size')).toHaveText(/600\s*×\s*700/);

    // r above half of the short side: Turkish error, nothing runs.
    await setField(page, 'prop-r', '400');
    await expect(page.getByTestId('prop-r-error')).toHaveText(ins.errors.rectRadius);
    await expect(page.getByTestId('editor-size')).toHaveText(/600\s*×\s*700/);
    await page.getByTestId('prop-r').press('Escape');
    await expect(page.getByTestId('prop-r-error')).toHaveCount(0);

    await setField(page, 'prop-qty', '0');
    await expect(page.getByTestId('prop-qty-error')).toHaveText(ins.errors.qty);
    await page.getByTestId('prop-qty').press('Escape');

    // Undo: H first, then W (one step each).
    await page.getByTestId('editor-canvas').focus();
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('editor-size')).toHaveText(/600\s*×\s*720/);
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('editor-size')).toHaveText(/560\s*×\s*720/);
  });

  test('segment length: a click on the edge middle picks it; end vertex slides, neighbour follows', async ({
    page,
  }) => {
    const canvas = await openBoard(page);
    await page.getByTestId('editor-part-list').getByRole('button').first().click();
    const s0 = await size(page);
    const p0 = await position(page);
    const v = await view(canvas);
    const b = await canvas.boundingBox();
    if (!b) throw new Error('no canvas');
    // Bottom edge middle (segment 0 of the rectangle).
    await page.mouse.click(b.x + (p0.x + s0.w / 2) * v.scale + v.x, b.y + v.y - p0.y * v.scale);
    await expect(page.getByTestId('prop-segment-pick')).toHaveAttribute('data-value', '0');
    await expect(page.getByTestId('prop-seg-length')).toHaveValue('560');
    await expect(page.getByTestId('prop-seg-angle')).toHaveValue('0');

    await setField(page, 'prop-seg-length', '700');
    // Bottom edge 700, the top edge stays 560: the box is 700 wide, the part became freeform.
    await expect(page.getByTestId('editor-size')).toHaveText(/700\s*×\s*720/);
    await expect(page.getByTestId('editor-inspector')).toContainText(ins.kind.freeform);

    await setField(page, 'prop-seg-length', '0');
    await expect(page.getByTestId('prop-seg-length-error')).toHaveText(ins.errors.length);
    await page.getByTestId('prop-seg-length').press('Escape');

    await page.getByTestId('editor-canvas').focus();
    await page.keyboard.press('Control+z');
    await expect(page.getByTestId('editor-size')).toHaveText(/560\s*×\s*720/);
    await expect(page.getByTestId('editor-inspector')).toContainText(ins.kind.rect);
  });

  test('vertex X/Y from the keyboard: picker, board coordinates, crossing refused', async ({
    page,
  }) => {
    await openBoard(page);
    await page.getByTestId('editor-part-list').getByRole('button').first().click();
    const p0 = await position(page);
    await pickOption(page.getByTestId('prop-vertex-pick'), fill(ins.vertexN, { n: 3 }));
    // Vertex 3 = top-right corner (560, 720) in the part frame.
    await expect
      .poll(async () => trNum(await page.getByTestId('prop-vertex-x').inputValue()))
      .toBeCloseTo(p0.x + 560, 1);
    await setField(page, 'prop-vertex-y', String(p0.y + 800));
    await expect(page.getByTestId('editor-size')).toHaveText(/560\s*×\s*800/);
    // Dragging the corner past the left side makes the outline cross itself.
    await setField(page, 'prop-vertex-x', String(p0.x - 300));
    await expect(page.getByTestId('prop-vertex-x-error')).toHaveText(ins.errors.crossing);
  });
});

test.describe('T254 board fit and focus ring', () => {
  for (const [w, h] of [
    [1440, 900],
    [1024, 768],
    [390, 844],
  ] as const) {
    test(`${w} × ${h}: fit frames the sheet and the parts`, async ({ page }) => {
      const canvas = await openBoard(page, w, h);
      const b = await canvas.boundingBox();
      if (!b) throw new Error('no canvas');
      const v = await view(canvas);
      const left = v.x;
      const right = 2800 * v.scale + v.x;
      const top = v.y - 2070 * v.scale;
      const bottom = v.y;
      expect(left).toBeGreaterThanOrEqual(22);
      expect(top).toBeGreaterThanOrEqual(22);
      expect(right).toBeLessThanOrEqual(b.width);
      expect(bottom).toBeLessThanOrEqual(b.height);
    });
  }

  test('keyboard focus shows a ring on all four sides (overlay above the canvas)', async ({
    page,
  }) => {
    const canvas = await openBoard(page);
    await canvas.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(canvas).toBeFocused();
    const shadow = await canvas.evaluate((el) => getComputedStyle(el, '::after').boxShadow);
    expect(shadow).toMatch(/inset/);
    const pos = await canvas.evaluate((el) => getComputedStyle(el, '::after').position);
    expect(pos).toBe('absolute');
  });
});

test.describe('B11 follow-up: toasts above the wizard footer', () => {
  for (const [w, h] of [
    [1440, 900],
    [390, 844],
  ] as const) {
    test(`${w} × ${h}: a toast never covers the footer's right-hand button (İleri here, İndir on step 5)`, async ({
      page,
    }) => {
      await openBoard(page, w, h);
      await page.getByTestId('editor-canvas').focus();
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Control+c');
      const toast = page.locator('[data-sonner-toast]').first();
      await expect(toast).toBeVisible();
      // Let the enter animation settle.
      await expect
        .poll(async () => (await toast.boundingBox())?.y ?? 0, { timeout: 3000 })
        .toBeGreaterThan(0);
      await page.waitForTimeout(500);
      const tb = await toast.boundingBox();
      const fb = await page.getByTestId('wizard-next').boundingBox();
      if (!tb || !fb) throw new Error('no box');
      expect(tb.y + tb.height).toBeLessThanOrEqual(fb.y + 0.5);
    });
  }
});
