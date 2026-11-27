import { expect, test, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { KITCHEN, openNewProject, paste, projectId, saved } from './wizard-helpers';

// B66: T382 flexible arc tool (sehim / 3 nokta / merkez modes, tangent at a line end, kuş kanadı
// profile, sweep in the inspector, arc end drag) and T383 (Ctrl+Z / Backspace / Esc inside a
// chain act on the chain, not on the project history).

interface V {
  x: number;
  y: number;
  bulge: number;
}
interface StoredPart {
  name: string;
  outline?: V[];
}

const hints = tr.editor.draw.hints;
const hint = (page: Page) => page.getByTestId('editor-hint');
const partRows = (page: Page) => page.getByTestId('editor-part-list').getByRole('button');
const trNum = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

async function openBoard(page: Page): Promise<Locator> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await paste(page, KITCHEN, 5);
  await page.getByTestId('parts-view-drawing').click();
  const canvas = page.getByTestId('editor-canvas');
  await expect(canvas).toHaveAttribute('data-view', /\d/);
  await expect(partRows(page)).toHaveCount(5);
  return canvas;
}

async function typeSegment(page: Page, length: number, angle: number) {
  await page.keyboard.type(String(length));
  await page.keyboard.press('Tab');
  await page.keyboard.type(String(angle));
  await page.keyboard.press('Enter');
}

async function stored(page: Page, name: string): Promise<V[]> {
  await saved(page);
  const id = await projectId(page);
  const res = await page.request.get(`/api/projects/${id}`);
  expect(res.ok()).toBe(true);
  const parts = ((await res.json()) as { project: { parts: StoredPart[] } }).project.parts;
  const found = parts.find((p) => p.name === name);
  if (!found?.outline) throw new Error(`no outline for ${name}`);
  return found.outline;
}

const sweepDeg = (b: number) => Math.abs((4 * Math.atan(b) * 180) / Math.PI);
function arcR(p: V, q: V, b: number): number {
  const c = Math.hypot(q.x - p.x, q.y - p.y);
  return c / 2 / Math.sin(2 * Math.atan(Math.abs(b)));
}

async function size(page: Page) {
  const text = (await page.getByTestId('editor-size').textContent()) ?? '';
  const m = /([\d.,]+)\s*×\s*([\d.,]+)/.exec(text);
  return { w: trNum(m?.[1] ?? 'NaN'), h: trNum(m?.[2] ?? 'NaN') };
}

test.describe('B66 T383: undo inside the line tool', () => {
  test('square with a wrong third side: Ctrl+Z drops that side, Ctrl+Y re-adds, the project history is untouched', async ({
    page,
  }) => {
    const canvas = await openBoard(page);
    const b = await canvas.boundingBox();
    if (!b) throw new Error('no canvas');
    await page.keyboard.press('l');
    await page.mouse.click(b.x + b.width * 0.55, b.y + b.height * 0.75);
    // The cursor leaves the start point (else the hint is "Kapat"); it is above the shape.
    await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.25);
    await typeSegment(page, 400, 0);
    await typeSegment(page, 300, 90);
    await typeSegment(page, 250, 180); // wrong: should be 400
    await page.keyboard.press('Control+z');
    // The last side is gone, the tool keeps drawing from the previous point; the pasted parts
    // (the last project command) are still there and nothing got selected.
    await expect(hint(page)).toHaveText(hints.lineNext);
    await expect(partRows(page)).toHaveCount(5);
    await expect(page.getByTestId('editor-tool-line')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('prop-group-segment')).toHaveCount(0);
    // Redo puts it back, undo again takes it away.
    await page.keyboard.press('Control+y');
    await page.keyboard.press('Control+z');
    await expect(partRows(page)).toHaveCount(5);
    await typeSegment(page, 400, 180);
    await typeSegment(page, 300, 270);
    await expect(partRows(page)).toHaveCount(6);
    const vs = await stored(page, 'Parça 6');
    expect(vs).toHaveLength(4);
    expect(await size(page)).toEqual({ w: 400, h: 300 });
    // After the chain: one Ctrl+Z undoes the whole shape, Ctrl+Y brings it back.
    await page.keyboard.press('Control+z');
    await expect(partRows(page)).toHaveCount(5);
    await page.keyboard.press('Control+y');
    await expect(partRows(page)).toHaveCount(6);
  });

  test('Backspace walks back to the first point and ends the chain; Esc keeps an open shape', async ({
    page,
  }) => {
    const canvas = await openBoard(page);
    const b = await canvas.boundingBox();
    if (!b) throw new Error('no canvas');
    await page.keyboard.press('l');
    await page.mouse.click(b.x + b.width * 0.55, b.y + b.height * 0.75);
    // The cursor leaves the start point (else the hint is "Kapat"); it is above the shape.
    await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.25);
    await typeSegment(page, 300, 0);
    await typeSegment(page, 200, 90);
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await expect(hint(page)).toHaveText(hints.lineNext);
    await page.keyboard.press('Backspace');
    await expect(hint(page)).toHaveText(hints.lineStart);
    await expect(partRows(page)).toHaveCount(5);
    // Ctrl+Y re-adds the points taken back.
    await page.keyboard.press('Control+y');
    await page.keyboard.press('Control+y');
    await page.keyboard.press('Control+y');
    await expect(hint(page)).toHaveText(hints.lineNext);
    await page.keyboard.press('Escape');
    await expect(hint(page)).toHaveText(hints.open);
    await page.keyboard.press('Escape');
    await expect(hint(page)).toHaveText(hints.lineStart);
    await expect(partRows(page)).toHaveCount(5);
  });
});

test.describe('B66 T382: flexible arc tool', () => {
  test('kuş kanadı: two arcs of different radius meeting at the ends, sweep typed, sweep edited in the panel', async ({
    page,
  }) => {
    const canvas = await openBoard(page);
    const b = await canvas.boundingBox();
    if (!b) throw new Error('no canvas');
    await page.keyboard.press('a');
    const opts = page.getByTestId('arc-options');
    await expect(opts).toBeVisible();
    await expect(page.getByTestId('arc-mode-bulge')).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.click(b.x + b.width * 0.45, b.y + b.height * 0.6);
    // The cursor leaves the start point (else the hint is "Kapat"); it is above the shape.
    await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.25);
    await typeSegment(page, 600, 0);
    await expect(hint(page)).toHaveText(hints.arcBend);
    await expect(page.getByTestId('editor-input-angle')).toBeVisible();
    await page.keyboard.press('Tab');
    await page.keyboard.type('60');
    await page.keyboard.press('Enter');
    // Second arc back to the start, much flatter: a wing-like profile, closed into a part.
    await expect(hint(page)).toHaveText(hints.arcEnd);
    await typeSegment(page, 600, 180);
    await page.keyboard.press('Tab');
    await page.keyboard.type('20');
    await page.keyboard.press('Enter');
    await expect(partRows(page)).toHaveCount(6);
    const vs = await stored(page, 'Parça 6');
    expect(vs).toHaveLength(2);
    const [p, q] = vs as [V, V];
    // The stored outline is normalised CCW, so the order of the two arcs is not fixed.
    const sweeps = [sweepDeg(p.bulge), sweepDeg(q.bulge)].sort((x, y) => x - y);
    expect(sweeps[0]).toBeCloseTo(20, 6);
    expect(sweeps[1]).toBeCloseTo(60, 6);
    const radii = [arcR(p, q, p.bulge), arcR(q, p, q.bulge)].sort((x, y) => x - y);
    expect(radii[0]).toBeCloseTo(600, 4);
    expect(radii[1]).toBeCloseTo(600 / 2 / Math.sin(Math.PI / 18), 3);
    // Inspector: the arc's sweep is shown and edited (the radius follows).
    await page.keyboard.press('v');
    await partRows(page).last().click();
    await page.getByTestId('prop-segment-pick').click();
    await page.getByRole('listbox').getByRole('option').first().click();
    const sweep = page.getByTestId('prop-seg-sweep');
    await expect(sweep).toHaveValue(/^(60|20)$/);
    await expect(page.getByTestId('prop-seg-arc-start')).toBeVisible();
    await sweep.fill('90');
    await sweep.press('Enter');
    await expect
      .poll(async () =>
        (await stored(page, 'Parça 6')).some((v) => Math.abs(sweepDeg(v.bulge) - 90) < 1e-6),
      )
      .toBe(true);
  });

  test('tangent at a line end, 3 nokta mode, and dragging an arc end keeps it an arc', async ({
    page,
  }) => {
    const canvas = await openBoard(page);
    const b = await canvas.boundingBox();
    if (!b) throw new Error('no canvas');
    await page.keyboard.press('l');
    await page.mouse.click(b.x + b.width * 0.4, b.y + b.height * 0.8);
    // The cursor leaves the start point (else the hint is "Kapat"); it is above the shape.
    await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.25);
    await typeSegment(page, 400, 0);
    await page.keyboard.press('a');
    await expect(page.getByTestId('arc-tangent')).toHaveAttribute('aria-pressed', 'true');
    await expect(hint(page)).toHaveText(hints.arcTangent);
    await typeSegment(page, 200, 90); // R 200, sweep 90°: a quarter turn leaving along the line
    await page.keyboard.press('l');
    await typeSegment(page, 600, 180);
    await typeSegment(page, 200, 270);
    await expect(partRows(page)).toHaveCount(6);
    expect(await size(page)).toEqual({ w: 600, h: 200 });
    const vs = await stored(page, 'Parça 6');
    expect(vs).toHaveLength(4);
    const arcAt = vs.findIndex((v) => v.bulge !== 0);
    expect(sweepDeg((vs[arcAt] as V).bulge)).toBeCloseTo(90, 6);

    // Drag the arc's end (top right corner) 40 px to the right, snapping off (Alt).
    await page.keyboard.press('v');
    await partRows(page).last().click();
    const [scale = 0, vx = 0, vy = 0] = ((await canvas.getAttribute('data-view')) ?? '')
      .split(',')
      .map(Number);
    const pos = (await page.getByTestId('editor-position').textContent()) ?? '';
    const m = /X\s*(-?[\d.,]+)\s*·\s*Y\s*(-?[\d.,]+)/.exec(pos);
    const px = trNum(m?.[1] ?? 'NaN');
    const py = trNum(m?.[2] ?? 'NaN');
    const hx = b.x + (px + 600) * scale + vx;
    const hy = b.y + vy - (py + 200) * scale;
    await page.keyboard.down('Alt');
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    await page.mouse.move(hx + 20, hy, { steps: 3 });
    await page.mouse.move(hx + 40, hy, { steps: 3 });
    await page.mouse.up();
    await page.keyboard.up('Alt');
    await expect.poll(async () => (await size(page)).w).toBeGreaterThan(600);
    const moved = await stored(page, 'Parça 6');
    expect(moved).toHaveLength(4);
    const arc2 = moved.findIndex((v) => v.bulge !== 0);
    expect(sweepDeg((moved[arc2] as V).bulge)).toBeCloseTo(90, 6);

    // 3 nokta: start, a point on the arc, end; the mode stays picked when the tool comes back.
    await page.keyboard.press('a');
    await page.getByTestId('arc-mode-3pt').click();
    await expect(page.getByTestId('arc-mode-3pt')).toHaveAttribute('aria-pressed', 'true');
    await expect(hint(page)).toHaveText(hints.arcStart);
    await page.mouse.click(b.x + b.width * 0.3, b.y + b.height * 0.3);
    await expect(hint(page)).toHaveText(hints.arcVia);
    await page.mouse.click(b.x + b.width * 0.35, b.y + b.height * 0.22);
    await expect(hint(page)).toHaveText(hints.arcVia2);
    await page.mouse.click(b.x + b.width * 0.4, b.y + b.height * 0.3);
    await expect(hint(page)).toHaveText(hints.arcVia);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    await page.keyboard.press('a');
    await expect(page.getByTestId('arc-mode-3pt')).toHaveAttribute('aria-pressed', 'true');
  });
});
