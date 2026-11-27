import { expect, test, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { KITCHEN, openNewProject, paste } from './wizard-helpers';

async function openBoard(page: Page): Promise<Locator> {
  await openNewProject(page, 'parcalar');
  await paste(page, KITCHEN, 5);
  await page.getByTestId('parts-view-drawing').click();
  const canvas = page.getByTestId('editor-canvas');
  await expect(canvas).toHaveAttribute('data-view', /\d/);
  return canvas;
}

const partRows = (page: Page) => page.getByTestId('editor-part-list').getByRole('button');
const hint = (page: Page) => page.getByTestId('editor-hint');

/** Types one segment: length, Tab, angle, Enter. */
async function segment(page: Page, length: number, angle: number) {
  await page.keyboard.type(String(length));
  await page.keyboard.press('Tab');
  await page.keyboard.type(String(angle));
  await page.keyboard.press('Enter');
}

test.describe('T128 line / polyline tool', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('an L-shape typed by length and angle closes into an exact freeform part', async ({
    page,
  }) => {
    const canvas = await openBoard(page);
    const b = await canvas.boundingBox();
    if (!b) throw new Error('no canvas');
    await page.keyboard.press('l');
    await expect(hint(page)).toHaveText(tr.editor.draw.hints.lineStart);
    await page.mouse.click(b.x + b.width * 0.55, b.y + b.height * 0.8);
    await expect(hint(page)).toHaveText(tr.editor.draw.hints.lineNext);
    await expect(page.getByTestId('editor-input-length')).toBeVisible();
    await segment(page, 600, 0);
    await segment(page, 300, 90);
    await segment(page, 300, 180);
    await segment(page, 300, 90);
    await segment(page, 300, 180);
    await segment(page, 600, 270);
    await expect(partRows(page)).toHaveCount(6);
    await expect(page.getByTestId('editor-size')).toHaveText(/600\s*×\s*600/);
    await expect(page.getByTestId('editor-inspector')).toContainText(
      tr.editor.inspector.kind.freeform,
    );
    // repeat mode: the tool stays active for the next shape
    await expect(page.getByTestId('editor-tool-line')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Control+z');
    await expect(partRows(page)).toHaveCount(5);
  });

  test('an open shape is not a part and says "kapalı değil"; Backspace and Esc', async ({
    page,
  }) => {
    const canvas = await openBoard(page);
    const b = await canvas.boundingBox();
    if (!b) throw new Error('no canvas');
    await page.getByTestId('editor-tool-line').click();
    await page.mouse.click(b.x + b.width * 0.6, b.y + b.height * 0.7);
    await page.mouse.click(b.x + b.width * 0.75, b.y + b.height * 0.7);
    await page.mouse.click(b.x + b.width * 0.75, b.y + b.height * 0.5);
    await page.keyboard.press('Enter');
    await expect(hint(page)).toHaveText(tr.editor.draw.hints.open);
    await expect(partRows(page)).toHaveCount(5);
    // Backspace drops the last vertex and resumes drawing; Delete never removes a part here
    await page.keyboard.press('Backspace');
    await expect(hint(page)).toHaveText(tr.editor.draw.hints.lineNext);
    await page.keyboard.press('Delete');
    await expect(partRows(page)).toHaveCount(5);
    // B66 (T383): Esc ends the chain keeping what is drawn (open), a second Esc drops it
    await page.keyboard.press('Escape');
    await expect(hint(page)).toHaveText(tr.editor.draw.hints.open);
    await page.keyboard.press('Escape');
    await expect(hint(page)).toHaveText(tr.editor.draw.hints.lineStart);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('editor-tool-select')).toHaveAttribute('aria-pressed', 'true');
  });

  test('clicking near the start shows "Kapat" and closes the shape', async ({ page }) => {
    const canvas = await openBoard(page);
    const b = await canvas.boundingBox();
    if (!b) throw new Error('no canvas');
    await page.keyboard.press('l');
    const p0 = { x: b.x + b.width * 0.6, y: b.y + b.height * 0.75 };
    // Alt: no snap, so the start sits exactly under the first click.
    await page.keyboard.down('Alt');
    await page.mouse.click(p0.x, p0.y);
    await page.mouse.click(p0.x + 120, p0.y);
    await page.mouse.click(p0.x + 60, p0.y - 90);
    await page.keyboard.up('Alt');
    await page.mouse.move(p0.x + 3, p0.y + 2);
    await expect(page.getByTestId('editor-snap-name')).toHaveText(tr.editor.draw.close);
    await expect(hint(page)).toHaveText(tr.editor.draw.hints.lineClose);
    await page.mouse.click(p0.x + 3, p0.y + 2);
    await expect(partRows(page)).toHaveCount(6);
  });
});
