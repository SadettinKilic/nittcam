import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { KITCHEN, openNewProject, paste } from './wizard-helpers';

// B14 tester (T138): Esc while drawing a hole, a hole across the part edge, undo, and the hole
// properties panel at 1440 / 1024 in light and dark (screenshots for review, axe, no h-scroll).

const trNum = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

async function openBoard(page: Page, width = 1440): Promise<Locator> {
  await page.setViewportSize({ width, height: 900 });
  await openNewProject(page, 'parcalar');
  await paste(page, KITCHEN, 5);
  await page.getByTestId('parts-view-drawing').click();
  const canvas = page.getByTestId('editor-canvas');
  await expect(canvas).toHaveAttribute('data-view', /\d/);
  return canvas;
}

async function screenOf(canvas: Locator, p: { x: number; y: number }) {
  const [scale = 0, vx = 0, vy = 0] = ((await canvas.getAttribute('data-view')) ?? '')
    .split(',')
    .map(Number);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas box');
  return { x: box.x + p.x * scale + vx, y: box.y + vy - p.y * scale, scale };
}

/** First part: lower-left corner and size in board mm, read from the inspector. */
async function firstPart(page: Page) {
  await selectFirst(page);
  const pos = (await page.getByTestId('editor-position').textContent()) ?? '';
  const size = (await page.getByTestId('editor-size').textContent()) ?? '';
  const p = /X\s*(-?[\d.,]+)\s*·\s*Y\s*(-?[\d.,]+)/.exec(pos);
  const s = /([\d.,]+)\s*×\s*([\d.,]+)/.exec(size);
  const x = trNum(p?.[1] ?? 'NaN');
  const y = trNum(p?.[2] ?? 'NaN');
  const w = trNum(s?.[1] ?? 'NaN');
  const h = trNum(s?.[2] ?? 'NaN');
  return { x, y, w, h, cx: x + w / 2, cy: y + h / 2 };
}

async function drawHole(page: Page, canvas: Locator, c: { x: number; y: number }, rMm: number) {
  await canvas.focus();
  await page.keyboard.press('o');
  await expect(canvas).toHaveAttribute('data-tool', 'hole');
  const at = await screenOf(canvas, c);
  await page.mouse.click(at.x, at.y);
  await page.mouse.move(at.x + rMm * at.scale, at.y, { steps: 4 });
  await page.mouse.click(at.x + rMm * at.scale, at.y);
}

test.describe('B14 tester: hole tool', () => {
  test('Esc drops the centre in progress (tool stays), a second Esc returns to Seç; nothing added', async ({
    page,
  }) => {
    const canvas = await openBoard(page);
    const part = await firstPart(page);
    await canvas.focus();
    await page.keyboard.press('o');
    const at = await screenOf(canvas, { x: part.cx, y: part.cy });
    await page.mouse.click(at.x, at.y);
    await page.mouse.move(at.x + 60 * at.scale, at.y, { steps: 3 });
    await page.keyboard.press('Escape');
    await expect(canvas).toHaveAttribute('data-tool', 'hole');

    await page.keyboard.press('Escape');
    await expect(canvas).toHaveAttribute('data-tool', 'select');
    await selectFirst(page);
    await expect(page.getByTestId('prop-group-holes')).toHaveCount(0);
  });

  test('a hole crossing the part edge is refused; a hole inside is added and undone with Ctrl+Z', async ({
    page,
  }) => {
    const canvas = await openBoard(page);
    const part = await firstPart(page);
    // Centre 20 mm in from the left edge, radius 40 mm: crosses the edge.
    await drawHole(page, canvas, { x: part.x + 20, y: part.cy }, 40);
    await expect(page.getByText(tr.editor.holeEdge)).toBeVisible();
    await page.keyboard.press('Escape');
    await selectFirst(page);
    await expect(page.getByTestId('prop-group-holes')).toHaveCount(0);

    await drawHole(page, canvas, { x: part.cx, y: part.cy }, 30);
    await page.keyboard.press('Escape');
    await selectFirst(page);
    await expect(page.getByTestId('prop-hole-0')).toBeVisible();
    await canvas.focus();
    await page.keyboard.press('Control+z');
    await selectFirst(page);
    await expect(page.getByTestId('prop-group-holes')).toHaveCount(0);
  });

  test('a tiny drag gives at least the tool diameter', async ({ page }) => {
    const canvas = await openBoard(page);
    const part = await firstPart(page);
    await drawHole(page, canvas, { x: part.cx, y: part.cy }, 0.5);
    await page.keyboard.press('Escape');
    await selectFirst(page);
    const d = trNum((await page.getByTestId('prop-hole-0-d').inputValue()) || 'NaN');
    expect(d).toBeGreaterThanOrEqual(6);
  });

  for (const width of [1440, 1024]) {
    for (const scheme of ['light', 'dark'] as const) {
      test(`hole panel ${width} px ${scheme}: screenshot, axe, no horizontal scroll`, async ({
        page,
      }) => {
        await page.emulateMedia({ colorScheme: scheme });
        const canvas = await openBoard(page, width);
        const part = await firstPart(page);
        await drawHole(page, canvas, { x: part.cx, y: part.cy }, 40);
        await page.keyboard.press('Escape');
        await selectFirst(page);
        await expect(page.getByTestId('prop-hole-0')).toBeVisible();
        // groove variant shows the most fields
        await page.getByTestId('prop-hole-0-filled').click();
        await expect(page.getByTestId('prop-hole-0-width')).toBeVisible();
        await page.getByTestId('prop-hole-0').scrollIntoViewIfNeeded();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        await page.screenshot({ path: `__screenshots__/b14-hole-panel-${width}-${scheme}.png` });
        const res = await new AxeBuilder({ page }).analyze();
        const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
        expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
      });
    }
  }
});

/** Selects the first part in the list; at laptop widths the list is collapsed behind a button. */
async function selectFirst(page: Page) {
  const show = page.getByRole('button', { name: 'Parça listesini göster' });
  if (await show.isVisible()) await show.click();
  await page.getByTestId('editor-part-list').getByRole('button').first().click();
}

async function setNum(page: Page, testId: string, v: string) {
  const input = page.getByTestId(testId);
  await input.click();
  await input.fill(v);
  await input.press('Enter');
  await expect(input).toHaveValue(new RegExp(v));
}

test('typed hole values, then the part turned clockwise (Shift+R): the hole turns with it', async ({
  page,
}) => {
  const canvas = await openBoard(page);
  const part = await firstPart(page);
  await drawHole(page, canvas, { x: part.cx, y: part.cy }, 40);
  await page.keyboard.press('Escape');
  await selectFirst(page);
  await setNum(page, 'prop-hole-0-d', '100');
  await setNum(page, 'prop-hole-0-cx', '150');
  await setNum(page, 'prop-hole-0-cy', '200');
  await page.screenshot({ path: '__screenshots__/b14-hole-typed-1440.png' });
  // Yan is 560 × 720; clockwise: (x, y) → (y, 560 − x) in the turned 720 × 560 frame.
  await canvas.focus();
  await page.keyboard.press('Shift+R');
  await expect(page.getByTestId('editor-size')).toContainText(/720\s*×\s*560/);
  await expect(page.getByTestId('prop-hole-0-cx')).toHaveValue(/^200/);
  await expect(page.getByTestId('prop-hole-0-cy')).toHaveValue(/^410/);
  await page.screenshot({ path: '__screenshots__/b14-hole-rotated-1440.png' });
});
