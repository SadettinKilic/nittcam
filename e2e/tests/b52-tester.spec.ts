import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { openNewProject, paste, pickOption, projectId, saved, wizardReady } from './wizard-helpers';

// B52 tester (D-096): undo of the board menu and of canvas drags, a cut-out cannot leave the part,
// "Hep böyle yap" is forgotten on reload, "2a" goes away on undo, a new hole takes the last one's
// values.
const trNum = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));
type Part = {
  holes: { type: string; d: number; depth?: number; cx: number; cy: number }[];
  inners: { x: number; y: number }[][];
};

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
  return { id, canvas, at: { x: trNum(m?.[1] ?? 'NaN'), y: trNum(m?.[2] ?? 'NaN') } };
}

async function screenOf(canvas: Locator, p: { x: number; y: number }) {
  const [scale = 0, vx = 0, vy = 0] = ((await canvas.getAttribute('data-view')) ?? '')
    .split(',')
    .map(Number);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas box');
  return { x: box.x + p.x * scale + vx, y: box.y + vy - p.y * scale, scale };
}

async function savedPart(page: Page, request: APIRequestContext, id: string): Promise<Part> {
  await saved(page);
  const cur = (await (await request.get(`/api/projects/${id}`)).json()) as {
    project: { parts: Part[] };
  };
  return cur.project.parts[0] as Part;
}

const undo = (page: Page) => page.keyboard.press('Control+z');
const partCount = (page: Page) => page.getByTestId('editor-part-list').getByRole('button');

test('B52 tester: board menu rotate / delete / duplicate are one undo step each', async ({
  page,
  request,
}) => {
  const { canvas, at } = await openKapak(page, request, {});
  const menuAt = async () => {
    const s = await screenOf(canvas, { x: at.x + 300, y: at.y + 300 });
    await page.mouse.click(s.x, s.y, { button: 'right' });
    await expect(page.getByTestId('board-menu')).toBeVisible();
  };
  await expect(page.getByTestId('editor-size')).toHaveText(/596\s*×\s*716/);
  await menuAt();
  await page.getByTestId('board-menu-rotate').click();
  await expect(page.getByTestId('editor-size')).toHaveText(/716\s*×\s*596/);
  await canvas.focus();
  await undo(page);
  await expect(page.getByTestId('editor-size')).toHaveText(/596\s*×\s*716/);

  await menuAt();
  await page.getByTestId('board-menu-duplicate').click();
  await expect(partCount(page)).toHaveCount(2);
  await canvas.focus();
  await undo(page);
  await expect(partCount(page)).toHaveCount(1);

  await menuAt();
  await page.getByTestId('board-menu-remove').click();
  await expect(partCount(page)).toHaveCount(0);
  await canvas.focus();
  await undo(page);
  await expect(partCount(page)).toHaveCount(1);

  // Escape closes the menu without doing anything.
  await menuAt();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('board-menu')).toBeHidden();
  await expect(partCount(page)).toHaveCount(1);
});

test('B52 tester: hole drag undoes; cut-out cannot be dragged out of the part; Delete + undo', async ({
  page,
  request,
}) => {
  const v = (x: number, y: number) => ({ x, y, bulge: 0 });
  const { id, canvas, at } = await openKapak(page, request, {
    holes: [{ id: 'h1', type: 'through', d: 30, cx: 450, cy: 600, tool: 2 }],
    inners: [[v(100, 100), v(100, 300), v(300, 300), v(300, 100)]],
  });
  // hole drag → undo puts it back
  const h = await screenOf(canvas, { x: at.x + 450, y: at.y + 600 });
  await page.mouse.move(h.x, h.y);
  await page.mouse.down();
  await page.mouse.move(h.x - 60 * h.scale, h.y, { steps: 6 });
  await page.mouse.up();
  await expect
    .poll(async () => trNum((await page.getByTestId('prop-hole-0-cx').inputValue()) || 'NaN'))
    .toBeCloseTo(390, -1);
  await canvas.focus();
  await undo(page);
  await expect.poll(async () => (await savedPart(page, request, id)).holes[0]?.cx).toBe(450);

  // cut-out dragged 500 mm to the right (past the 596 mm edge): never outside the part
  const a = await screenOf(canvas, { x: at.x + 200, y: at.y + 200 });
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(a.x + 500 * a.scale, a.y, { steps: 8 });
  await page.mouse.up();
  const p1 = await savedPart(page, request, id);
  const vs = p1.inners[0] ?? [];
  expect(vs).toHaveLength(4);
  for (const q of vs) {
    expect(q.x).toBeGreaterThan(0);
    expect(q.x).toBeLessThan(596);
    expect(q.y).toBeGreaterThan(0);
    expect(q.y).toBeLessThan(716);
  }
  // the panel refuses an X that pushes it out
  const x = page.getByTestId('prop-inner-x');
  await expect(x).toBeVisible();
  await x.fill('500');
  await x.press('Enter');
  const p2 = await savedPart(page, request, id);
  expect(Math.max(...(p2.inners[0] ?? []).map((q) => q.x))).toBeLessThan(596);
  // refused: the field is marked invalid, the stored cut-out did not move
  await expect(x).toHaveAttribute('aria-invalid', 'true');
  await x.press('Escape');

  // Delete removes the picked cut-out only; undo brings it back
  await canvas.focus();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('prop-inner')).toHaveCount(0);
  await expect(partCount(page)).toHaveCount(1);
  await undo(page);
  await expect(page.getByTestId('prop-inner')).toHaveCount(1);
});

test('B52 tester: a new hole takes the last hole’s values ("aynı değerlerle devam")', async ({
  page,
  request,
}) => {
  const { id, canvas, at } = await openKapak(page, request, {});
  const holeAt = async (c: { x: number; y: number }, typed: string) => {
    await canvas.focus();
    await page.keyboard.press('o');
    await expect(canvas).toHaveAttribute('data-tool', 'hole');
    const s = await screenOf(canvas, c);
    await page.mouse.click(s.x, s.y);
    // the prefilled Ø holds only while the cursor stays on the centre (> 6 px = live sizing)
    if (typed) await page.mouse.move(s.x + 10, s.y + 3, { steps: 2 });
    await page.waitForTimeout(200); // let the draft render before the keys
    if (typed) await page.keyboard.type(typed);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
  };
  await holeAt({ x: at.x + 150, y: at.y + 150 }, '35');
  await page.getByTestId('editor-part-list').getByRole('button').first().click();
  const through = page.getByTestId('prop-hole-0-through');
  await expect(through).toBeVisible();
  await through.click(); // through → blind (with a default depth)
  // poll: "Kaydedildi" can still show from before the edit started saving
  await expect
    .poll(async () => (await savedPart(page, request, id)).holes[0]?.type)
    .not.toBe('through');
  const first = (await savedPart(page, request, id)).holes[0];
  // the next hole: Ø prefilled, so Enter alone adds it with the same type / depth
  await holeAt({ x: at.x + 400, y: at.y + 500 }, '');
  await expect.poll(async () => (await savedPart(page, request, id)).holes.length).toBe(2);
  const p = await savedPart(page, request, id);
  expect(p.holes[1]?.d).toBe(35);
  expect(p.holes[1]?.type).toBe(first?.type);
  expect(p.holes[1]?.depth).toBe(first?.depth);
});

test('B52 tester: "Hep böyle yap" is forgotten on reload; "2a" goes away on undo', async ({
  page,
  request,
}) => {
  const { canvas, at } = await openKapak(page, request, {});
  const rect = async (x: number, y: number) => {
    await canvas.focus();
    await page.keyboard.press('r');
    const a = await screenOf(canvas, { x: at.x + x, y: at.y + y });
    const b = await screenOf(canvas, { x: at.x + x + 100, y: at.y + y + 100 });
    await page.keyboard.down('Alt');
    await page.mouse.click(a.x, a.y);
    await page.mouse.click(b.x, b.y);
    await page.keyboard.up('Alt');
  };
  const prompt = page.getByTestId('inner-prompt');
  await rect(100, 100);
  await page.getByTestId('inner-prompt-always').click();
  await page.getByTestId('inner-prompt-inner').click();
  await expect(prompt).toBeHidden();
  await saved(page);
  await page.reload();
  await wizardReady(page, 'parcalar');
  await expect(canvas).toHaveAttribute('data-view', /\d/);
  await rect(300, 400);
  await expect(prompt).toBeVisible();
  await page.getByTestId('inner-prompt-cancel').click();
  await expect(prompt).toBeHidden();
  await page.keyboard.press('Escape');

  // "2a" after splitting edge 2; undo gives the old numbers back
  const ins = tr.editor.inspector;
  const vname = (n: string) => ins.vertexN.replace('{n}', n);
  await page.getByTestId('editor-part-list').getByRole('button').first().click();
  await pickOption(page.getByTestId('prop-segment-pick'), ins.segmentN.replace('{n}', '2'));
  await page.getByTestId('prop-seg-split').click();
  await expect(page.getByTestId('prop-vertex-pick')).toContainText(vname('2a'));
  await canvas.focus();
  await undo(page);
  await expect(page.getByTestId('prop-vertex-pick')).not.toContainText(vname('2a'));
  await pickOption(page.getByTestId('prop-vertex-pick'), vname('3'));
  await expect(page.getByTestId('prop-vertex-x')).toHaveValue('596');
  await expect(page.getByTestId('prop-vertex-y')).toHaveValue('716');
});

const SHOTS = '__screenshots__/b52-tester';
async function axe(page: Page) {
  await page.waitForTimeout(400);
  const res = await new AxeBuilder({ page }).analyze();
  return res.violations
    .filter((x) => ['serious', 'critical'].includes(x.impact ?? ''))
    .map((x) => `${x.id}: ${x.nodes.length}`);
}

for (const scheme of ['light', 'dark'] as const) {
  test(`B52 tester: board menu, picked cut-out and cut-out question pass axe at 1440 ${scheme}`, async ({
    page,
    request,
  }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    const v = (x: number, y: number) => ({ x, y, bulge: 0 });
    const { canvas, at } = await openKapak(page, request, {
      holes: [{ id: 'h1', type: 'through', d: 30, cx: 450, cy: 600, tool: 2 }],
      inners: [[v(100, 100), v(100, 300), v(300, 300), v(300, 100)]],
    });
    // picked cut-out with its panel
    const c = await screenOf(canvas, { x: at.x + 200, y: at.y + 200 });
    await page.mouse.click(c.x, c.y);
    await expect(page.getByTestId('prop-inner-x')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/inner-picked-${scheme}.png` });
    expect(await axe(page)).toEqual([]);
    // right-click menu open
    const m = await screenOf(canvas, { x: at.x + 450, y: at.y + 300 });
    await page.mouse.click(m.x, m.y, { button: 'right' });
    await expect(page.getByTestId('board-menu')).toBeVisible();
    // opens at the cursor (under reduced motion it first flashes at the canvas corner for ~70 ms)
    await expect
      .poll(async () => (await page.getByTestId('board-menu').boundingBox())?.x ?? 0)
      .toBeCloseTo(m.x, -1);
    await page.screenshot({ path: `${SHOTS}/menu-${scheme}.png` });
    expect(await axe(page)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('board-menu')).toBeHidden();
    // Escape may also drop the part (sheet view): pick it again, coordinates change
    await page.getByTestId('editor-part-list').getByRole('button').first().click();
    await page.waitForTimeout(300);
    // the "İç kesim olarak ekle?" question
    await canvas.focus();
    await page.keyboard.press('r');
    const a = await screenOf(canvas, { x: at.x + 350, y: at.y + 100 });
    const b = await screenOf(canvas, { x: at.x + 450, y: at.y + 200 });
    await page.keyboard.down('Alt');
    await page.mouse.click(a.x, a.y);
    await page.mouse.click(b.x, b.y);
    await page.keyboard.up('Alt');
    await expect(page.getByTestId('inner-prompt')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/inner-prompt-${scheme}.png` });
    expect(await axe(page)).toEqual([]);
    await page.getByTestId('inner-prompt-cancel').click();
  });
}
