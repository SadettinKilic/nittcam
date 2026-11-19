import { expect, test, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { KITCHEN, openNewProject, paste } from './wizard-helpers';

// B14 / T138: hole tool on the drawing board and the hole properties.

const hole = tr.editor.inspector.hole;
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

/** Screen point of a board point (mm, Y up), from the canvas `data-view`. */
async function screenOf(canvas: Locator, p: { x: number; y: number }) {
  const [scale = 0, vx = 0, vy = 0] = ((await canvas.getAttribute('data-view')) ?? '')
    .split(',')
    .map(Number);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas box');
  return { x: box.x + p.x * scale + vx, y: box.y + vy - p.y * scale, scale };
}

/** Centre of the first part in board mm, read from the inspector. */
async function firstPartCentre(page: Page) {
  await page.getByTestId('editor-part-list').getByRole('button').first().click();
  const pos = (await page.getByTestId('editor-position').textContent()) ?? '';
  const size = (await page.getByTestId('editor-size').textContent()) ?? '';
  const p = /X\s*(-?[\d.,]+)\s*·\s*Y\s*(-?[\d.,]+)/.exec(pos);
  const s = /([\d.,]+)\s*×\s*([\d.,]+)/.exec(size);
  return {
    x: trNum(p?.[1] ?? 'NaN') + trNum(s?.[1] ?? 'NaN') / 2,
    y: trNum(p?.[2] ?? 'NaN') + trNum(s?.[2] ?? 'NaN') / 2,
  };
}

test.describe('T138 hole tool', () => {
  test('click centre, drag the diameter, click again: a through hole on the part', async ({
    page,
  }) => {
    const canvas = await openBoard(page);
    const c = await firstPartCentre(page);

    await canvas.focus();
    await page.keyboard.press('o');
    await expect(canvas).toHaveAttribute('data-tool', 'hole');
    await expect(page.getByTestId('editor-tool-hole')).toHaveAttribute('aria-pressed', 'true');

    const at = await screenOf(canvas, c);
    await page.mouse.click(at.x, at.y);
    // The diameter grows live with the cursor (Ø label on the canvas, hint in the status bar).
    await page.mouse.move(at.x + 100 * at.scale, at.y, { steps: 4 });
    await expect(page.getByText(tr.editor.holeHint)).toBeVisible();
    await page.mouse.click(at.x + 100 * at.scale, at.y);

    // Still the hole tool (repeat mode); Esc returns to Seç.
    await expect(canvas).toHaveAttribute('data-tool', 'hole');
    await page.keyboard.press('Escape');
    await expect(canvas).toHaveAttribute('data-tool', 'select');

    await page.getByTestId('editor-part-list').getByRole('button').first().click();
    const row = page.getByTestId('prop-hole-0');
    await expect(row).toBeVisible();
    await expect(row).toContainText(hole.type.through);
    await expect(page.getByTestId('prop-hole-0-filled')).toBeChecked();
    await expect(page.getByTestId('prop-hole-0-through')).toBeChecked();
    const d = trNum((await page.getByTestId('prop-hole-0-d').inputValue()) || 'NaN');
    expect(d).toBeGreaterThan(150);
    expect(d).toBeLessThan(250);

    // "İçini boşalt" off → ring groove with width and depth; on again → pocket with depth.
    await page.getByTestId('prop-hole-0-filled').click();
    await expect(row).toContainText(hole.type.groove);
    await expect(row).toContainText(hole.ringOnly);
    await expect(page.getByTestId('prop-hole-0-width')).toBeVisible();
    await expect(page.getByTestId('prop-hole-0-depth')).toBeVisible();
    await page.getByTestId('prop-hole-0-filled').click();
    await expect(row).toContainText(hole.type.pocket);
    await expect(page.getByTestId('prop-hole-0-through')).not.toBeChecked();
    await expect(page.getByTestId('prop-hole-0-width')).toHaveCount(0);

    // Diameter typed in the panel; delete removes the hole.
    const input = page.getByTestId('prop-hole-0-d');
    await input.click();
    await input.fill('35');
    await input.press('Enter');
    await expect(input).toHaveValue(/35/);
    await page.getByTestId('prop-hole-0-remove').click();
    await expect(page.getByTestId('prop-group-holes')).toHaveCount(0);
  });

  test('a centre outside every part is refused with a Turkish message', async ({ page }) => {
    const canvas = await openBoard(page);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('no canvas box');
    await page.getByTestId('editor-tool-hole').click();
    // Right edge of the canvas, mid height: empty board (the fit leaves a margin).
    await page.mouse.click(box.x + box.width - 40, box.y + box.height / 2);
    await expect(page.getByText(tr.editor.holeRefused)).toBeVisible();
  });
});
