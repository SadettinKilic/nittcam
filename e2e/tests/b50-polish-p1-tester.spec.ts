import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  fill,
  openNewProject,
  optionLabels,
  paste,
  pickOption,
  projectId,
  saved,
  wizardReady,
} from './wizard-helpers';

// B50 tester (polish P1): what the dev spec leaves out. A window door (cut-out) with 3+ holes of
// all three kinds, an L part and a small part on one board; error rows stay visible when closed;
// "Ortasına köşe ekle" undoes; the inner-cut dialog fits at 1440 and Enter adds the inner cut;
// the shortcut sheet lists Alt and Shift+F; axe at 1440 light/dark and a 390 smoke; review shots.
const ins = tr.editor.inspector;
const SHOTS = '__screenshots__/b50-tester';
const v = (x: number, y: number) => ({ x, y, bulge: 0 });

async function seed(request: APIRequestContext, id: string) {
  const cur = (await (await request.get(`/api/projects/${id}`)).json()) as {
    revision: number;
    project: { parts: Record<string, unknown>[] };
  };
  const byName = (n: string) => {
    const p = cur.project.parts.find((x) => x.name === n);
    if (!p) throw new Error(`no ${n}`);
    return p;
  };
  const kapak = byName('Kapak');
  // Window door: one rectangular cut-out (CW), and 4 holes: through, pocket, groove, too small.
  kapak.inners = [[v(150, 150), v(150, 566), v(446, 566), v(446, 150)]];
  kapak.holes = [
    { id: 'h1', type: 'through', d: 10, cx: 75, cy: 75, tool: 2 },
    { id: 'h2', type: 'pocket', d: 35, depth: 12, cx: 75, cy: 358, tool: 2 },
    { id: 'h3', type: 'groove', d: 40, depth: 5, grooveWidth: 8, cx: 521, cy: 358, tool: 2 },
    { id: 'h4', type: 'through', d: 5, cx: 521, cy: 75, tool: 2 },
  ];
  const ell = byName('Lparca');
  delete ell.params;
  ell.kind = 'freeform';
  ell.outline = [v(0, 0), v(500, 0), v(500, 150), v(150, 150), v(150, 400), v(0, 400)];
  const res = await request.put(`/api/projects/${id}`, {
    data: { project: cur.project, baseRevision: cur.revision, commands: [] },
  });
  expect(res.status()).toBe(200);
}

async function openBoard(page: Page, request: APIRequestContext, width = 1440, height = 900) {
  await page.setViewportSize({ width, height });
  await openNewProject(page, 'parcalar');
  await paste(
    page,
    'Ad\tEn\tBoy\tAdet\nKapak\t596\t716\t1\nLparca\t500\t400\t1\nKucuk\t200\t150\t1',
    3,
  );
  await saved(page);
  const id = await projectId(page);
  await seed(request, id);
  await page.goto(`/projeler/${id}?adim=parcalar&gorunum=cizim`);
  await wizardReady(page, 'parcalar');
  await expect(page.getByTestId('editor-canvas')).toHaveAttribute('data-view', /\d/);
}

async function pick(page: Page, name: string) {
  await page
    .getByTestId('editor-part-list')
    .getByRole('button', { name: new RegExp(name) })
    .click();
}

const scaleOf = async (page: Page) =>
  Number(
    ((await page.getByTestId('editor-canvas').getAttribute('data-view')) ?? '0').split(',')[0],
  );

async function axe(page: Page) {
  await page.waitForTimeout(400);
  const res = await new AxeBuilder({ page }).analyze();
  return res.violations
    .filter((x) => ['serious', 'critical'].includes(x.impact ?? ''))
    .map((x) => `${x.id}: ${x.nodes.length}`);
}

test('B50 tester: error rows stay visible when closed; 4 holes; hint wraps', async ({
  page,
  request,
}) => {
  await openBoard(page, request);
  await pick(page, 'Kapak');
  // h4 (Ø5 on T2 Ø8) has an error: open by default (also the newest); h1 closed; h3 (groove) closed.
  await expect(page.getByTestId('prop-hole-0')).toHaveAttribute('data-open', 'false');
  await expect(page.getByTestId('prop-hole-2')).toHaveAttribute('data-open', 'false');
  await expect(page.getByTestId('prop-hole-2')).toContainText('Ø40 · 5 mm · T2');
  const bad = page.getByTestId('prop-hole-3');
  await expect(bad).toHaveAttribute('data-open', 'true');
  await expect(bad).toHaveAttribute('data-error', /HOLE_SMALLER_THAN_TOOL/);
  await page.getByTestId('prop-hole-3-toggle').click();
  await expect(bad).toHaveAttribute('data-open', 'false');
  await expect(page.getByTestId('prop-hole-3-error').first()).toBeVisible();
  await expect(page.getByTestId('prop-hole-3-toggle')).toHaveAttribute('aria-expanded', 'false');
  // Status-bar hint: may wrap (no single-line truncate).
  const hint = page.getByTestId('editor-hint');
  if ((await hint.count()) > 0) await expect(hint).not.toHaveClass(/\btruncate\b/);
});

test('B50 tester: split corner undoes; Shift+F without a selection does nothing', async ({
  page,
  request,
}) => {
  await openBoard(page, request);
  const canvas = page.getByTestId('editor-canvas');
  await canvas.focus();
  await page.keyboard.press('Escape');
  const s0 = await scaleOf(page);
  await page.keyboard.press('Shift+F');
  await page.waitForTimeout(300);
  expect(await scaleOf(page)).toBe(s0);
  await pick(page, 'Kucuk');
  const vertexPick = page.getByTestId('prop-vertex-pick');
  await pickOption(page.getByTestId('prop-segment-pick'), fill(ins.segmentN, { n: 2 }));
  await page.getByTestId('prop-seg-split').click();
  await expect(vertexPick).toHaveAttribute('data-value', '2');
  await expect(page.getByTestId('editor-size')).toHaveText(/200\s*×\s*150/);
  expect(await optionLabels(vertexPick)).toHaveLength(5);
  await canvas.focus();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await optionLabels(vertexPick)).length).toBe(4);
  await canvas.focus();
  await page.keyboard.press('Control+y');
  await expect.poll(async () => (await optionLabels(vertexPick)).length).toBe(5);
});

test('B50 tester: inner-cut dialog fits at 1440 and Enter adds the inner cut', async ({
  page,
  request,
}) => {
  await openBoard(page, request);
  await pick(page, 'Lparca');
  const canvas = page.getByTestId('editor-canvas');
  const text = (await page.getByTestId('editor-position').textContent()) ?? '';
  const m = /X\s*(-?[\d.,]+)\s*·\s*Y\s*(-?[\d.,]+)/.exec(text);
  const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));
  const p0 = { x: num(m?.[1] ?? 'NaN'), y: num(m?.[2] ?? 'NaN') };
  const [sc = 0, ox = 0, oy = 0] = ((await canvas.getAttribute('data-view')) ?? '')
    .split(',')
    .map(Number);
  const b = await canvas.boundingBox();
  if (!b) throw new Error('no canvas');
  const scr = (x: number, y: number) => ({ x: b.x + x * sc + ox, y: b.y + oy - y * sc });
  await page.keyboard.press('r');
  const a = scr(p0.x + 30, p0.y + 30);
  const c = scr(p0.x + 110, p0.y + 110);
  await page.keyboard.down('Alt');
  await page.mouse.click(a.x, a.y);
  await page.mouse.click(c.x, c.y);
  await page.keyboard.up('Alt');
  const prompt = page.getByTestId('inner-prompt');
  await expect(prompt).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.getByTestId('inner-prompt-inner')).toBeFocused();
  // All three buttons inside the dialog box.
  const box = await prompt.boundingBox();
  for (const id of ['inner-prompt-cancel', 'inner-prompt-part', 'inner-prompt-inner']) {
    const bb = await page.getByTestId(id).boundingBox();
    expect(bb && box && bb.x >= box.x && bb.x + bb.width <= box.x + box.width + 0.5).toBe(true);
  }
  await page.screenshot({ path: `${SHOTS}/inner-dialog-1440.png` });
  expect(await axe(page)).toEqual([]);
  await expect(page.getByTestId('inner-prompt-inner')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(prompt).toHaveCount(0);
  await page.keyboard.press('v');
  await pick(page, 'Lparca');
  await expect(page.getByTestId('prop-inner')).toHaveCount(1);
});

test('B50 tester: shortcut sheet lists Alt and Shift+F', async ({ page, request }) => {
  await openBoard(page, request);
  await page.getByTestId('editor-shortcuts').click();
  const dialog = page.getByTestId('shortcuts-dialog');
  await expect(dialog.getByTestId('shortcut-boardSnapHold')).toContainText('Alt');
  await expect(dialog.getByTestId('shortcut-boardSnapHold')).toContainText(
    tr.shortcuts.items.boardSnapHold,
  );
  await expect(dialog.getByTestId('shortcut-boardFitSelection')).toContainText(
    tr.shortcuts.items.boardFitSelection,
  );
});

for (const scheme of ['light', 'dark'] as const) {
  test(`B50 tester: board shots + axe at 1440 ${scheme}`, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await openBoard(page, request);
    await pick(page, 'Kapak');
    await page.screenshot({ path: `${SHOTS}/board-kapak-${scheme}.png` });
    expect(await axe(page)).toEqual([]);
    await page.getByTestId('editor-canvas').focus();
    await page.keyboard.press('Shift+F');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/board-kapak-fit-${scheme}.png` });
    await pick(page, 'Lparca');
    await page.screenshot({ path: `${SHOTS}/board-ell-${scheme}.png` });
    // Small part at about 39 %: zoom out from the fitted view.
    await pick(page, 'Kucuk');
    await page.getByTestId('editor-canvas').focus();
    for (let i = 0; i < 8 && (await scaleOf(page)) > 0.45; i++) await page.keyboard.press('-');
    for (let i = 0; i < 8 && (await scaleOf(page)) < 0.33; i++) await page.keyboard.press('+');
    await page.screenshot({ path: `${SHOTS}/board-small-${scheme}.png` });
    await page.keyboard.press('Shift+F');
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/board-small-fit-${scheme}.png` });
  });
}

test('B50 tester: 390 smoke (no page scroll, axe)', async ({ page, request }) => {
  await openBoard(page, request, 390, 844);
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(sw).toBeLessThanOrEqual(390);
  await page.screenshot({ path: `${SHOTS}/board-390.png` });
  expect(await axe(page)).toEqual([]);
});
