import { expect, test, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { fill, openNewProject, paste } from './wizard-helpers';

// T276 (CTO review #7 C): at the default fit (coarse grid) a hinge cup 22,5 mm from the edge
// lands where it is clicked; the diameter can be typed + Enter; the same centre twice and a hole
// across the edge are refused with their reason, in a toast off the properties panel.

const trNum = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

async function screenOf(canvas: Locator, p: { x: number; y: number }) {
  const [scale = 0, vx = 0, vy = 0] = ((await canvas.getAttribute('data-view')) ?? '')
    .split(',')
    .map(Number);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas box');
  return { x: box.x + p.x * scale + vx, y: box.y + vy - p.y * scale, scale };
}

async function selectFirst(page: Page) {
  const show = page.getByRole('button', { name: 'Parça listesini göster' });
  if (await show.isVisible()) await show.click();
  await page.getByTestId('editor-part-list').getByRole('button').first().click();
}

async function firstPart(page: Page) {
  await selectFirst(page);
  const pos = (await page.getByTestId('editor-position').textContent()) ?? '';
  const p = /X\s*(-?[\d.,]+)\s*·\s*Y\s*(-?[\d.,]+)/.exec(pos);
  return { x: trNum(p?.[1] ?? 'NaN'), y: trNum(p?.[2] ?? 'NaN') };
}

async function holeAt(page: Page, canvas: Locator, c: { x: number; y: number }, typed: string) {
  await canvas.focus();
  await page.keyboard.press('o');
  await expect(canvas).toHaveAttribute('data-tool', 'hole');
  const at = await screenOf(canvas, c);
  await page.mouse.click(at.x, at.y);
  await page.mouse.move(at.x + 10, at.y + 3, { steps: 2 });
  await page.keyboard.type(typed);
  await page.keyboard.press('Enter');
}

test('T276: hinge cup near the edge, typed diameter, duplicate and edge refusals', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await paste(page, 'Ad\tEn\tBoy\tAdet\nKapak\t596\t716\t1', 1);
  await page.getByTestId('parts-view-drawing').click();
  const canvas = page.getByTestId('editor-canvas');
  await expect(canvas).toHaveAttribute('data-view', /\d/);
  const part = await firstPart(page);
  await expect(page.getByText(tr.editor.holeHint)).toHaveCount(0);

  // Hinge cup: centre 22,5 mm from the left edge, 100 mm up; Ø35 typed.
  await holeAt(page, canvas, { x: part.x + 22.5, y: part.y + 100 }, '35');
  await expect(page.getByText(tr.editor.holeEdge)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await selectFirst(page);
  const cx = trNum(await page.getByTestId('prop-hole-0-cx').inputValue());
  const cy = trNum(await page.getByTestId('prop-hole-0-cy').inputValue());
  expect(Math.abs(cx - 22.5)).toBeLessThan(4);
  expect(Math.abs(cy - 100)).toBeLessThan(4);
  expect(Number.isInteger(cx) && Number.isInteger(cy)).toBe(true);
  await expect(page.getByTestId('prop-hole-0-d')).toHaveValue(/^35/);

  // The same centre again: refused, the existing hole is named.
  await holeAt(page, canvas, { x: part.x + 22.5, y: part.y + 100 }, '');
  await expect(page.getByText(fill(tr.editor.holeDuplicate, { n: 1 }))).toBeVisible();
  await page.keyboard.press('Escape');

  // A hole that really crosses the edge: refused with the reason, off the properties panel.
  await holeAt(page, canvas, { x: part.x + 10, y: part.y + 400 }, '35');
  const toast = page.getByText(tr.editor.holeEdge);
  await expect(toast).toBeVisible();
  const panel = await page.getByTestId('editor-inspector').boundingBox();
  const box = await toast.boundingBox();
  if (panel && box) expect(box.x + box.width).toBeLessThanOrEqual(panel.x + 1);
  await page.keyboard.press('Escape');
  await selectFirst(page);
  await expect(page.getByTestId('prop-hole-1')).toHaveCount(0);
});
