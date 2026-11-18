import { expect, test, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { KITCHEN, openNewProject, paste } from './wizard-helpers';

/** Opens a new project with the kitchen cut list (5 parts) on the drawing board. */
async function openBoard(page: Page): Promise<Locator> {
  await openNewProject(page, 'parcalar');
  await paste(page, KITCHEN, 5);
  await page.getByTestId('parts-view-drawing').click();
  const canvas = page.getByTestId('editor-canvas');
  await expect(canvas).toHaveAttribute('data-view', /\d/);
  return canvas;
}

async function canvasBox(canvas: Locator) {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas box');
  return box;
}

const partRows = (page: Page) => page.getByTestId('editor-part-list').getByRole('button');

test.describe('T127 rectangle and circle tools', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('rail shows only working tools; the active one is pressed and stays after a shape', async ({
    page,
  }) => {
    await openBoard(page);
    const rail = page.getByRole('toolbar', { name: tr.editor.tools.label });
    await expect(rail.locator('button:disabled')).toHaveCount(0);
    await page.keyboard.press('r');
    await expect(page.getByTestId('editor-tool-rect')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('editor-canvas')).toHaveClass(/cursor-crosshair/);
    await expect(page.getByTestId('editor-hint')).toHaveText(tr.editor.draw.hints.rectStart);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('editor-tool-select')).toHaveAttribute('aria-pressed', 'true');
  });

  test('typed En;Boy gives an exact rectangle part, named and selected; undo removes it', async ({
    page,
  }) => {
    const canvas = await openBoard(page);
    const b = await canvasBox(canvas);
    await page.getByTestId('editor-tool-rect').click();
    await page.mouse.click(b.x + b.width * 0.7, b.y + b.height * 0.3);
    await expect(page.getByTestId('editor-hint')).toHaveText(tr.editor.draw.hints.rectEnd);
    await expect(page.getByTestId('editor-dynamic-input')).toBeVisible();
    await page.keyboard.type('596');
    await page.keyboard.press('Tab');
    await page.keyboard.type('716');
    await expect(page.getByTestId('editor-input-h')).toHaveText(/716/);
    await page.keyboard.press('Enter');
    await expect(partRows(page)).toHaveCount(6);
    await expect(page.getByTestId('editor-part-list')).toContainText('Parça 6');
    await expect(page.getByTestId('editor-size')).toHaveText(/596\s*×\s*716/);
    await expect(page.getByTestId('editor-tool-rect')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Control+z');
    await expect(partRows(page)).toHaveCount(5);
  });

  test('drag draws a rectangle; Esc cancels a started one', async ({ page }) => {
    const canvas = await openBoard(page);
    const b = await canvasBox(canvas);
    await page.keyboard.press('r');
    const x0 = b.x + b.width * 0.6;
    const y0 = b.y + b.height * 0.25;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x0 + 40, y0 + 30, { steps: 4 });
    await page.mouse.move(x0 + 80, y0 + 60, { steps: 4 });
    await page.mouse.up();
    await expect(partRows(page)).toHaveCount(6);
    // started, then cancelled
    await page.mouse.click(x0, y0 + 120);
    await expect(page.getByTestId('editor-dynamic-input')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('editor-dynamic-input')).toHaveCount(0);
    await expect(partRows(page)).toHaveCount(6);
  });

  test('circle: centre + typed R → freeform part of diameter 2R', async ({ page }) => {
    const canvas = await openBoard(page);
    const b = await canvasBox(canvas);
    await page.keyboard.press('c');
    await page.mouse.click(b.x + b.width * 0.7, b.y + b.height * 0.4);
    await page.keyboard.type('150');
    await page.keyboard.press('Enter');
    await expect(partRows(page)).toHaveCount(6);
    await expect(page.getByTestId('editor-size')).toHaveText(/300\s*×\s*300/);
    await expect(page.getByTestId('editor-inspector')).toContainText(
      tr.editor.inspector.kind.freeform,
    );
  });
});

test.describe('T127 phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('a rectangle can be drawn with taps only; the chip docks as a bar', async ({ page }) => {
    const canvas = await openBoard(page);
    const b = await canvasBox(canvas);
    await page.getByTestId('editor-tool-rect').tap();
    await page.touchscreen.tap(b.x + b.width * 0.5, b.y + b.height * 0.5);
    await expect(page.getByTestId('editor-dynamic-input')).toHaveAttribute('data-docked', 'true');
    await page.touchscreen.tap(b.x + b.width * 0.75, b.y + b.height * 0.3);
    await expect(page.getByTestId('editor-canvas')).toHaveAttribute('aria-label', /6 parça/);
  });
});
