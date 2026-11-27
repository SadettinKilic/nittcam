import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { KITCHEN, goStep, nest, openNewProject, paste, projectId, saved } from './wizard-helpers';

// B66 tester: kuş kanadı (line + two arcs of different radius meeting at a sharp tip) drawn with
// typed values, nested and exported; the G2/G3 lines must be self-consistent (radius at start
// equals radius at end) and match the drawn radii; Merkez mode; Ctrl+Shift+Z redo.

const hints = tr.editor.draw.hints;
const hint = (page: Page) => page.getByTestId('editor-hint');
const partRows = (page: Page) => page.getByTestId('editor-part-list').getByRole('button');

async function typeSegment(page: Page, length: number, angle: number) {
  await page.keyboard.type(String(length));
  await page.keyboard.press('Tab');
  await page.keyboard.type(String(angle));
  await page.keyboard.press('Enter');
}

async function board(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await paste(page, KITCHEN, 5);
  await page.getByTestId('parts-view-drawing').click();
  const canvas = page.getByTestId('editor-canvas');
  await expect(canvas).toHaveAttribute('data-view', /\d/);
  await expect(partRows(page)).toHaveCount(5);
  const b = await canvas.boundingBox();
  if (!b) throw new Error('no canvas');
  return b;
}

test('kuş kanadı: line + two arcs (R 585 / R 283) with a sharp tip; NC arcs consistent', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const b = await board(page);
  await page.keyboard.press('l');
  await page.mouse.click(b.x + b.width * 0.45, b.y + b.height * 0.7);
  await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.3);
  await typeSegment(page, 400, 0);
  // Free arcs (tangent off): chord 400 @120 sweep 40, then chord 400 @240 sweep 90 back to start.
  await page.keyboard.press('a');
  if ((await page.getByTestId('arc-tangent').getAttribute('aria-pressed')) === 'true') {
    await page.getByTestId('arc-tangent').click();
  }
  await page.mouse.move(b.x + b.width * 0.62, b.y + b.height * 0.2);
  await typeSegment(page, 400, 120);
  await page.keyboard.press('Tab');
  await page.keyboard.type('40');
  await page.keyboard.press('Enter');
  await expect(hint(page)).toHaveText(hints.arcEnd);
  await typeSegment(page, 400, 240);
  await page.keyboard.press('Tab');
  await page.keyboard.type('90');
  await page.keyboard.press('Enter');
  await expect(partRows(page)).toHaveCount(6);
  await saved(page);
  const id = await projectId(page);
  const res = await page.request.get(`/api/projects/${id}`);
  const parts = (
    (await res.json()) as { project: { parts: { name: string; outline?: { bulge: number }[] }[] } }
  ).project.parts;
  const wing = parts.find((p) => p.name === 'Parça 6')?.outline ?? [];
  const sweeps = wing
    .map((v) => (4 * Math.atan(Math.abs(v.bulge)) * 180) / Math.PI)
    .filter((s) => s > 1);
  expect(sweeps.map((s) => Math.round(s)).sort()).toEqual([40, 90]);

  await nest(page);
  await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 30_000 });
  await goStep(page, 'export');
  await expect(page.getByTestId('export-status')).toHaveAttribute('data-ok', 'true', {
    timeout: 30_000,
  });
  await page.getByTestId('export-check-origin').check();
  await page.getByTestId('export-check-tool').check();
  await page.getByTestId('export-check-aircut').check();
  if (await page.getByTestId('export-accept').isVisible())
    await page.getByTestId('export-accept').check();
  const download = page.getByTestId('export-download');
  await expect(download).toBeEnabled();
  const files = await page.getByTestId('export-files').locator('li').count();
  let text = '';
  if (files === 1) {
    const d = (await Promise.all([page.waitForEvent('download'), download.click()]))[0];
    text = (await readFile(await d.path())).toString('utf8');
  } else {
    await download.click();
    const links = page.getByTestId('export-ready').getByRole('link');
    await expect(links.first()).toBeVisible();
    const n = await links.count();
    for (let k = 0; k < n; k++) {
      const d = (await Promise.all([page.waitForEvent('download'), links.nth(k).click()]))[0];
      text += '\n' + (await readFile(await d.path())).toString('utf8');
    }
  }

  // Walk the program: incremental I/J (the example profile), track XY.
  let px = 0;
  let py = 0;
  const radii: number[] = [];
  const num = (l: string, k: string) => {
    const m = new RegExp(`${k}(-?[0-9]+(?:[.][0-9]+)?)`).exec(l);
    return m ? Number(m[1]) : undefined;
  };
  for (const raw of text.split('\n')) {
    const l = raw.replace(/\(.*?\)/g, '');
    const x = num(l, 'X') ?? px;
    const y = num(l, 'Y') ?? py;
    if (/\bG0?[23]\b/.test(l)) {
      const i = num(l, 'I') ?? 0;
      const j = num(l, 'J') ?? 0;
      const r0 = Math.hypot(i, j);
      const r1 = Math.hypot(x - (px + i), y - (py + j));
      expect(Math.abs(r0 - r1), `arc radius mismatch: ${raw}`).toBeLessThan(0.01);
      radii.push(r0);
    }
    px = x;
    py = y;
  }
  console.log(
    'NC arc radii',
    JSON.stringify(
      radii.reduce<Record<string, number>>(
        (a, r) => ({ ...a, [r.toFixed(1)]: (a[r.toFixed(1)] ?? 0) + 1 }),
        {},
      ),
    ),
  );
  expect(radii.length).toBeGreaterThan(0);
  // Contour radii are the drawn ones offset by the tool radius (<= 6 mm): both arcs present.
  const near = (r: number) => radii.some((x) => Math.abs(x - r) < 6);
  expect(near(400 / 2 / Math.sin((20 * Math.PI) / 180))).toBe(true);
  expect(near(400 / 2 / Math.sin((45 * Math.PI) / 180))).toBe(true);
});

test('Merkez mode: start, centre, sweep past 180° makes one arc; Ctrl+Shift+Z redoes in a chain', async ({
  page,
}) => {
  const b = await board(page);
  await page.keyboard.press('a');
  await page.getByTestId('arc-mode-centre').click();
  await expect(hint(page)).toHaveText(hints.arcStart);
  const cx = b.x + b.width * 0.5;
  const cy = b.y + b.height * 0.5;
  await page.mouse.click(cx + 100, cy);
  await expect(hint(page)).toHaveText(hints.arcCentre);
  await page.mouse.click(cx, cy);
  await expect(hint(page)).toHaveText(hints.arcSweep);
  // Sweep over the top, past 180°, finish below-left.
  await page.mouse.move(cx, cy - 100, { steps: 4 });
  await page.mouse.move(cx - 100, cy, { steps: 4 });
  await page.mouse.move(cx - 60, cy + 80, { steps: 4 });
  await page.mouse.click(cx - 60, cy + 80);
  await expect(hint(page)).not.toHaveText(hints.arcSweep);
  // Chain undo/redo with the alternative shortcut.
  await page.keyboard.press('Control+z');
  await expect(hint(page)).toHaveText(hints.arcCentre);
  await page.keyboard.press('Control+Shift+z');
  await expect(partRows(page)).toHaveCount(5);
  await expect(page.getByTestId('editor-tool-arc')).toHaveAttribute('aria-pressed', 'true');
});

test('390 px smoke: arc options bar does not cause page-level horizontal scroll', async ({
  page,
}) => {
  await board(page);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.keyboard.press('a');
  await expect(page.getByTestId('arc-options')).toBeVisible();
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(over).toBeLessThanOrEqual(0);
});
