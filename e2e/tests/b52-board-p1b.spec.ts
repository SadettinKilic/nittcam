import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { openNewProject, paste, pickOption, projectId, saved, wizardReady } from './wizard-helpers';

// B52 (polish P1b, D-092): right-click menu, holes and cut-outs picked and dragged on the canvas,
// cut-out box in the panel.
const trNum = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

async function openKapak(
  page: Page,
  request: APIRequestContext,
  extra: { holes?: unknown[]; inners?: unknown[] },
) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await paste(page, 'Ad\tEn\tBoy\tAdet\nKapak\t596\t716\t1', 1);
  await saved(page);
  const id = await projectId(page);
  const cur = (await (await request.get(`/api/projects/${id}`)).json()) as {
    revision: number;
    project: { parts: Record<string, unknown>[] };
  };
  const part = cur.project.parts[0];
  if (!part) throw new Error('no part');
  Object.assign(part, extra);
  const res = await request.put(`/api/projects/${id}`, {
    data: { project: cur.project, baseRevision: cur.revision, commands: [] },
  });
  expect(res.status()).toBe(200);
  await page.goto(`/projeler/${id}?adim=parcalar&gorunum=cizim`);
  await wizardReady(page, 'parcalar');
  const canvas = page.getByTestId('editor-canvas');
  await expect(canvas).toHaveAttribute('data-view', /\d/);
  await page.getByTestId('editor-part-list').getByRole('button').first().click();
  const pos = (await page.getByTestId('editor-position').textContent()) ?? '';
  const m = /X\s*(-?[\d.,]+)\s*·\s*Y\s*(-?[\d.,]+)/.exec(pos);
  return { canvas, at: { x: trNum(m?.[1] ?? 'NaN'), y: trNum(m?.[2] ?? 'NaN') } };
}

/** Screen point of a board point (mm, Y up). */
async function screenOf(canvas: Locator, p: { x: number; y: number }) {
  const [scale = 0, vx = 0, vy = 0] = ((await canvas.getAttribute('data-view')) ?? '')
    .split(',')
    .map(Number);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas box');
  return { x: box.x + p.x * scale + vx, y: box.y + vy - p.y * scale, scale };
}

test('B52: right-click menu duplicates the part under the cursor', async ({ page, request }) => {
  const { canvas, at } = await openKapak(page, request, {});
  const s = await screenOf(canvas, { x: at.x + 300, y: at.y + 300 });
  await page.mouse.click(s.x, s.y, { button: 'right' });
  const menu = page.getByTestId('board-menu');
  await expect(menu).toBeVisible();
  await expect(page.getByTestId('board-menu-template')).toBeVisible();
  await page.getByTestId('board-menu-duplicate').click();
  await expect(menu).toBeHidden();
  await expect(page.getByTestId('editor-part-list').getByRole('button')).toHaveCount(2);
});

test('B52: a hole is picked and dragged on the canvas; Delete removes only the hole', async ({
  page,
  request,
}) => {
  const { canvas, at } = await openKapak(page, request, {
    holes: [{ id: 'h1', type: 'through', d: 30, cx: 200, cy: 200, tool: 2 }],
  });
  const a = await screenOf(canvas, { x: at.x + 200, y: at.y + 200 });
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 50 * a.scale, a.y, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByTestId('prop-hole-0')).toHaveAttribute('data-open', 'true');
  await expect
    .poll(async () => trNum((await page.getByTestId('prop-hole-0-cx').inputValue()) || 'NaN'))
    .toBeCloseTo(250, -1);
  await canvas.focus();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('prop-hole-0')).toHaveCount(0);
  await expect(page.getByTestId('editor-part-list').getByRole('button')).toHaveCount(1);
});

test('B52: a cut-out is moved on the canvas and resized in the panel', async ({
  page,
  request,
}) => {
  const v = (x: number, y: number) => ({ x, y, bulge: 0 });
  const { canvas, at } = await openKapak(page, request, {
    inners: [[v(100, 100), v(100, 300), v(300, 300), v(300, 100)]],
  });
  const a = await screenOf(canvas, { x: at.x + 200, y: at.y + 200 });
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x, a.y - 40 * a.scale, { steps: 6 });
  await page.mouse.up();
  const y = page.getByTestId('prop-inner-y');
  await expect(y).toBeVisible();
  await expect.poll(async () => trNum((await y.inputValue()) || 'NaN')).toBeCloseTo(140, -1);
  const w = page.getByTestId('prop-inner-width');
  await w.fill('150');
  await w.press('Enter');
  await expect(page.getByTestId('prop-inner')).toContainText(/150\s*×\s*200/);
});

test('B52: "Hep böyle yap" asks "İç kesim olarak ekle?" once', async ({ page, request }) => {
  const { canvas, at } = await openKapak(page, request, {});
  const rect = async (x: number, y: number) => {
    const a = await screenOf(canvas, { x: at.x + x, y: at.y + y });
    const b = await screenOf(canvas, { x: at.x + x + 100, y: at.y + y + 100 });
    await page.mouse.click(a.x, a.y, { modifiers: ['Alt'] });
    await page.mouse.click(b.x, b.y, { modifiers: ['Alt'] });
  };
  await canvas.focus();
  await page.keyboard.press('r');
  await rect(100, 100);
  const prompt = page.getByTestId('inner-prompt');
  await expect(prompt).toContainText(tr.editor.inner.always);
  await page.getByTestId('inner-prompt-always').click();
  await page.getByTestId('inner-prompt-inner').click();
  await expect(prompt).toBeHidden();
  await expect(page.getByTestId('prop-inner')).toHaveCount(1);
  await rect(300, 400);
  await expect(prompt).toBeHidden();
  await page.keyboard.press('Escape');
  await page.getByTestId('editor-part-list').getByRole('button').first().click();
  await expect(page.getByTestId('prop-inner')).toHaveCount(2);
});

test('B52: corner X/Y are part-relative, numbers stay after "Ortasına köşe ekle"; right angles kept', async ({
  page,
  request,
}) => {
  await openKapak(page, request, {});
  const ins = tr.editor.inspector;
  const vname = (n: string) => ins.vertexN.replace('{n}', n);
  // Bottom edge: 596 → 500 keeps the right angles (the box shrinks, no slanted edge).
  await pickOption(page.getByTestId('prop-segment-pick'), ins.segmentN.replace('{n}', '1'));
  await expect(page.getByTestId('prop-seg-keep-right')).toBeChecked();
  const len = page.getByTestId('prop-seg-length');
  await len.fill('500');
  await len.press('Enter');
  await expect(page.getByTestId('editor-size')).toHaveText(/500\s*×\s*716/);
  // Split edge 2 (right side): the new corner is "2a", corner 3 keeps its number.
  await pickOption(page.getByTestId('prop-segment-pick'), ins.segmentN.replace('{n}', '2'));
  await page.getByTestId('prop-seg-split').click();
  await expect(page.getByTestId('prop-vertex-pick')).toContainText(vname('2a'));
  await expect(page.getByTestId('prop-vertex-x')).toHaveValue('500');
  await expect(page.getByTestId('prop-vertex-y')).toHaveValue('358');
  await pickOption(page.getByTestId('prop-vertex-pick'), vname('3'));
  await expect(page.getByTestId('prop-vertex-y')).toHaveValue('716');
});

test('B52: line tool takes the direction from an arrow key when only a length is typed', async ({
  page,
  request,
}) => {
  const { canvas } = await openKapak(page, request, {});
  await canvas.focus();
  await page.keyboard.press('l');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas box');
  // Start far right of the part (empty board), then 100 up via ↑, 100 left via ←, 100 down.
  const sx = box.x + box.width - 120;
  const sy = box.y + box.height - 120;
  await page.mouse.click(sx, sy, { modifiers: ['Alt'] });
  for (const k of ['ArrowUp', 'ArrowLeft', 'ArrowDown']) {
    await page.mouse.move(sx + 5, sy + 5);
    await page.keyboard.type('100');
    await page.keyboard.press(k);
    await page.keyboard.press('Enter');
  }
  // Close back to the start: a 100 × 100 square part.
  await page.keyboard.type('100');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('editor-part-list').getByRole('button')).toHaveCount(2);
  await expect(page.getByTestId('editor-size')).toHaveText(/100\s*×\s*100/);
});
