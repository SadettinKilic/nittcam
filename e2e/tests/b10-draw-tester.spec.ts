import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { KITCHEN, goStep, openNewProject, paste, projectId, saved } from './wizard-helpers';

// B10 tester (T127–T129): what the dev specs leave out. Stored geometry read back from the API
// (typed sizes exact, CCW outline, arc radius), redo, persistence after reload, the cut list and
// nesting, an open polyline never saved, phone keypad bar + pinch while a tool is active, touch
// bend handle, rail keyboard path and axe with a shape in progress at 1440/390 light/dark.

interface V {
  x: number;
  y: number;
  bulge: number;
}
interface StoredPart {
  id: string;
  name: string;
  kind: string;
  qty: number;
  params?: { w: number; h: number; r: number };
  outline?: V[];
  draw?: { x: number; y: number };
}
interface StoredProject {
  parts: StoredPart[];
  layout: { sheets: { placements: { partId: string }[] }[] };
}

async function openBoard(page: Page, width = 1440): Promise<Locator> {
  await page.setViewportSize({ width, height: width > 600 ? 900 : 844 });
  await openNewProject(page, 'parcalar');
  await paste(page, KITCHEN, 5);
  await page.getByTestId('parts-view-drawing').click();
  const canvas = page.getByTestId('editor-canvas');
  await expect(canvas).toHaveAttribute('data-view', /\d/);
  return canvas;
}

async function view(canvas: Locator) {
  const [scale = 0, x = 0, y = 0] = ((await canvas.getAttribute('data-view')) ?? '')
    .split(',')
    .map(Number);
  return { scale, x, y };
}

/** The project as stored on the server (after the autosave settled). */
async function stored(page: Page): Promise<StoredProject> {
  await saved(page);
  const id = await projectId(page);
  const res = await page.request.get(`/api/projects/${id}`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { project: StoredProject }).project;
}

function part(p: StoredProject, name: string): StoredPart {
  const found = p.parts.find((x) => x.name === name);
  if (!found) throw new Error(`no part ${name} in ${p.parts.map((x) => x.name).join(', ')}`);
  return found;
}

/** Shoelace area of the straight-edge polygon (positive = CCW). */
function signedArea(vs: readonly V[]): number {
  let a = 0;
  for (let i = 0; i < vs.length; i++) {
    const p = vs[i] as V;
    const q = vs[(i + 1) % vs.length] as V;
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** Radius of the arc p → q with bulge b (chord / 2 / sin(θ/2), θ = 4·atan b). */
function arcR(p: V, q: V, b: number): number {
  const c = Math.hypot(q.x - p.x, q.y - p.y);
  return c / 2 / Math.sin(2 * Math.atan(Math.abs(b)));
}

const partRows = (page: Page) => page.getByTestId('editor-part-list').getByRole('button');

async function typeSegment(page: Page, length: number, angle: number) {
  await page.keyboard.type(String(length));
  await page.keyboard.press('Tab');
  await page.keyboard.type(String(angle));
  await page.keyboard.press('Enter');
}

async function touch(canvas: Locator, type: string, id: number, x: number, y: number) {
  await canvas.dispatchEvent(type, {
    pointerId: id,
    pointerType: 'touch',
    clientX: x,
    clientY: y,
    button: 0,
    isPrimary: id === 1,
  });
}

test.describe('B10 tester: stored geometry (T127–T129)', () => {
  test('typed rectangle is stored exactly; redo; cut list; survives reload', async ({ page }) => {
    const canvas = await openBoard(page);
    await saved(page);
    const b = await canvas.boundingBox();
    if (!b) throw new Error('no canvas');
    await page.keyboard.press('r');
    await page.mouse.click(b.x + b.width * 0.7, b.y + b.height * 0.3);
    await page.keyboard.type('596,5');
    await page.keyboard.press('Tab');
    await page.keyboard.type('716');
    await page.keyboard.press('Enter');
    await expect(partRows(page)).toHaveCount(6);
    const p1 = part(await stored(page), 'Parça 6');
    expect(p1.kind).toBe('rect');
    expect(p1.params).toEqual({ w: 596.5, h: 716, r: 0 });
    expect(p1.qty).toBe(1);
    // undo / redo (Ctrl+Y and Ctrl+Shift+Z)
    await page.keyboard.press('Control+z');
    await expect(partRows(page)).toHaveCount(5);
    await page.keyboard.press('Control+y');
    await expect(partRows(page)).toHaveCount(6);
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+Shift+z');
    await expect(partRows(page)).toHaveCount(6);
    expect(part(await stored(page), 'Parça 6')).toEqual(p1);
    // the cut list shows it with its size
    await page.getByTestId('parts-view-list').click();
    await expect(page.getByTestId('cut-list-count')).toContainText('31');
    await expect
      .poll(() => page.$$eval('input', (els) => els.map((e) => (e as HTMLInputElement).value)))
      .toContain('Parça 6');
    await saved(page);
    await page.reload();
    await expect(page.getByTestId('cut-list-count')).toContainText('31');
    expect(part(await stored(page), 'Parça 6')).toEqual(p1);
  });

  test('clockwise L-shape by typed lengths → exact CCW outline; it is nested', async ({ page }) => {
    const canvas = await openBoard(page);
    await saved(page);
    const b = await canvas.boundingBox();
    if (!b) throw new Error('no canvas');
    await page.keyboard.press('l');
    await page.mouse.click(b.x + b.width * 0.55, b.y + b.height * 0.85);
    // clockwise: up, right, down, right, down, left
    await typeSegment(page, 600, 90);
    await typeSegment(page, 300, 0);
    await typeSegment(page, 300, 270);
    await typeSegment(page, 300, 0);
    await typeSegment(page, 300, 270);
    await typeSegment(page, 600, 180);
    await expect(partRows(page)).toHaveCount(6);
    const p = part(await stored(page), 'Parça 6');
    expect(p.kind).toBe('freeform');
    const vs = p.outline ?? [];
    expect(vs.every((v) => v.bulge === 0)).toBe(true);
    expect(signedArea(vs)).toBeCloseTo(600 * 600 - 300 * 300, 6);
    const key = (v: { x: number; y: number }) => `${v.x},${v.y}`;
    expect(vs.map(key).sort()).toEqual(
      ['0,0', '600,0', '600,300', '300,300', '300,600', '0,600'].sort(),
    );
    // it goes into the layout
    await goStep(page, 'dizilim');
    await page.getByRole('button', { name: tr.cutList.nesting.run, exact: true }).click();
    await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(async () =>
        (await stored(page)).layout.sheets.flatMap((x) => x.placements).map((x) => x.partId),
      )
      .toContain(p.id);
    expect((await stored(page)).parts.length).toBe(6);
  });

  test('circle R 150 and arc R 400 are stored with exactly those radii', async ({ page }) => {
    const canvas = await openBoard(page);
    await saved(page);
    const b = await canvas.boundingBox();
    if (!b) throw new Error('no canvas');
    // rail button, not the C key: see the 'C stays on the board' test
    await page.getByTestId('editor-tool-circle').click();
    await page.mouse.click(b.x + b.width * 0.75, b.y + b.height * 0.3);
    await page.keyboard.type('150');
    await page.keyboard.press('Enter');
    await expect(partRows(page)).toHaveCount(6);
    await page.keyboard.press('a');
    await page.mouse.click(b.x + b.width * 0.5, b.y + b.height * 0.85);
    await typeSegment(page, 600, 0);
    await page.keyboard.type('400');
    await page.keyboard.press('Enter');
    await page.keyboard.press('l');
    await typeSegment(page, 600, 180);
    await expect(partRows(page)).toHaveCount(7);
    const s = await stored(page);
    const circle = part(s, 'Parça 6');
    expect(circle.kind).toBe('freeform');
    expect(circle.outline).toEqual([
      { x: 0, y: 150, bulge: 1 },
      { x: 300, y: 150, bulge: 1 },
    ]);
    const arc = part(s, 'Parça 7');
    const vs = arc.outline ?? [];
    expect(signedArea(vs.map((v) => ({ ...v, bulge: 0 })))).toBe(0); // two points: chord only
    const i = vs.findIndex((v) => v.bulge !== 0);
    expect(i).toBeGreaterThanOrEqual(0);
    const r = arcR(vs[i] as V, vs[(i + 1) % vs.length] as V, (vs[i] as V).bulge);
    expect(r).toBeCloseTo(400, 6);
  });

  test('the C key picks the circle tool and stays on the board (no "new project")', async ({
    page,
  }) => {
    // Bug B10-1: the board does not consume C, so the global shortcut C = newProject also fires
    // and navigates to /projeler/yeni a moment later.
    await openBoard(page);
    await saved(page);
    const url = page.url();
    await page.getByTestId('editor-canvas').focus();
    await page.keyboard.press('c');
    await expect(page.getByTestId('editor-tool-circle')).toHaveAttribute('aria-pressed', 'true');
    // no navigation within 3 s
    const left = await page
      .waitForURL((u) => u.toString() !== url, { timeout: 3_000 })
      .then(
        () => true,
        () => false,
      );
    expect(left).toBe(false);
    await expect(page.getByTestId('editor-canvas')).toBeVisible();
  });

  test('an open polyline is never saved and never nested', async ({ page }) => {
    const canvas = await openBoard(page);
    await saved(page);
    const b = await canvas.boundingBox();
    if (!b) throw new Error('no canvas');
    await page.keyboard.press('l');
    await page.mouse.click(b.x + b.width * 0.6, b.y + b.height * 0.7);
    await typeSegment(page, 400, 0);
    await typeSegment(page, 300, 90);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('editor-hint')).toHaveText(tr.editor.draw.hints.open);
    expect((await stored(page)).parts).toHaveLength(5);
    await goStep(page, 'dizilim');
    await page.getByRole('button', { name: tr.cutList.nesting.run, exact: true }).click();
    await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
    expect((await stored(page)).parts).toHaveLength(5);
  });
});

test.describe('B10 tester round 2: board keys vs global shortcuts (B10-1)', () => {
  async function stays(page: Page, url: string, ms = 1_000): Promise<void> {
    const left = await page
      .waitForURL((u) => u.toString() !== url, { timeout: ms })
      .then(
        () => true,
        () => false,
      );
    expect(left).toBe(false);
  }

  test('every board key and "g h" stay on the board; "g p" still navigates', async ({ page }) => {
    await openBoard(page);
    await saved(page);
    const url = page.url();
    await page.getByTestId('editor-canvas').focus();
    for (const k of ['v', 'h', 'r', 'l', 'a', 'f', '+', '=', '-', 'c']) {
      await page.keyboard.press(k);
      await page.keyboard.press('Escape');
    }
    await stays(page, url, 3_000);
    await expect(page.getByTestId('editor-canvas')).toBeVisible();
    // g h: H belongs to the board (pan), so "go home" must not fire
    await page.keyboard.press('g');
    await page.keyboard.press('h');
    await expect(page.getByTestId('editor-tool-pan')).toHaveAttribute('aria-pressed', 'true');
    await stays(page, url, 2_000);
    // g p: P is not a board key, the global sequence still works on the board
    await page.keyboard.press('Escape');
    await page.keyboard.press('g');
    await page.keyboard.press('p');
    await page.waitForURL(/\/projeler$/);
    // board unmounted → claim released: C is "new project" again
    await page.keyboard.press('c');
    await page.waitForURL(/\/projeler\/yeni/);
  });

  test('help opens over the board, Esc closes it; after leaving Çizim C is global again', async ({
    page,
  }) => {
    await openBoard(page);
    await saved(page);
    const url = page.url();
    await page.getByTestId('editor-canvas').focus();
    await page.keyboard.press('r');
    await page.keyboard.press('?');
    await expect(page.getByTestId('shortcuts-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('shortcuts-dialog')).toBeHidden();
    await expect(page.getByTestId('editor-tool-rect')).toHaveAttribute('aria-pressed', 'true');
    await stays(page, url);
    // list view: the board is gone, C opens a new project again
    await page.getByTestId('parts-view-list').click();
    await expect(page.getByTestId('editor-canvas')).toHaveCount(0);
    await page.getByTestId('parts-view-list').focus();
    await page.keyboard.press('c');
    await page.waitForURL((u) => u.toString() !== url && /\/projeler\/yeni/.test(u.pathname));
  });

  test('keys typed in the keypad bar field never reach the board or the shell', async ({
    page,
  }) => {
    const canvas = await openBoard(page, 390);
    await saved(page);
    const url = page.url();
    const b = await canvas.boundingBox();
    if (!b) throw new Error('no canvas');
    await page.getByTestId('editor-tool-rect').click();
    await page.mouse.click(b.x + b.width * 0.5, b.y + b.height * 0.4);
    const field = page.getByTestId('editor-input-w');
    await field.focus();
    await page.keyboard.type('clvh');
    await expect(page.getByTestId('editor-tool-rect')).toHaveAttribute('aria-pressed', 'true');
    await stays(page, url, 2_000);
  });
});

test.describe('B10 tester: rail keyboard path and axe', () => {
  test('every rail tool is a named, reachable button with its shortcut; Esc / V back to Seç', async ({
    page,
  }) => {
    await openBoard(page);
    const rail = page.getByRole('toolbar', { name: tr.editor.tools.label });
    const keys: Record<string, string> = {
      select: 'V',
      pan: 'H',
      rect: 'R',
      circle: 'C',
      line: 'L',
      arc: 'A',
    };
    for (const [tool, key] of Object.entries(keys)) {
      const btn = page.getByTestId(`editor-tool-${tool}`);
      await expect(btn).toBeVisible();
      await expect(btn).toBeEnabled();
      expect((await btn.getAttribute('aria-keyshortcuts'))?.toUpperCase()).toBe(key);
      expect(await btn.getAttribute('aria-label')).toBeTruthy();
    }
    expect(await rail.getByRole('button').count()).toBe(Object.keys(keys).length);
    // keyboard: focus the rect button, Enter picks it
    await page.getByTestId('editor-tool-rect').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('editor-tool-rect')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('editor-canvas').focus();
    await page.keyboard.press('v');
    await expect(page.getByTestId('editor-tool-select')).toHaveAttribute('aria-pressed', 'true');
    for (const k of ['c', 'l', 'a']) {
      await page.keyboard.press(k);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('editor-tool-select')).toHaveAttribute('aria-pressed', 'true');
    }
  });

  for (const scheme of ['light', 'dark'] as const) {
    for (const width of [1440, 390]) {
      test(`axe with a rectangle in progress: ${width} px ${scheme}`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        const canvas = await openBoard(page, width);
        const b = await canvas.boundingBox();
        if (!b) throw new Error('no canvas');
        await page.getByTestId('editor-tool-rect').click();
        await page.mouse.click(b.x + b.width * 0.5, b.y + b.height * 0.5);
        await page.mouse.move(b.x + b.width * 0.7, b.y + b.height * 0.35);
        await expect(page.getByTestId('editor-dynamic-input')).toBeVisible();
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        const res = await new AxeBuilder({ page }).analyze();
        const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
        expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
      });
    }
  }
});

test.describe('B10 tester: phone (390 px, touch)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('keypad bar: decimal fields, typed En;Boy via ✓ gives an exact rectangle', async ({
    page,
  }) => {
    const canvas = await openBoard(page, 390);
    await saved(page);
    const b = await canvas.boundingBox();
    if (!b) throw new Error('no canvas');
    await page.getByTestId('editor-tool-rect').tap();
    await page.touchscreen.tap(b.x + b.width * 0.5, b.y + b.height * 0.4);
    const bar = page.getByTestId('editor-dynamic-input');
    await expect(bar).toHaveAttribute('data-docked', 'true');
    const w = page.getByTestId('editor-input-w');
    const h = page.getByTestId('editor-input-h');
    await expect(w).toHaveAttribute('inputmode', 'decimal');
    await expect(h).toHaveAttribute('inputmode', 'decimal');
    // bar inside the canvas, not off-screen
    const bb = await bar.boundingBox();
    expect(bb && bb.y + bb.height <= b.y + b.height + 1).toBe(true);
    expect(bb && bb.x >= 0 && bb.x + bb.width <= 390).toBe(true);
    await w.fill('450');
    await h.fill('320,5');
    await bar.getByRole('button', { name: tr.editor.draw.apply }).tap();
    await expect(page.getByTestId('editor-canvas')).toHaveAttribute('aria-label', /6 parça/);
    const p = part(await stored(page), 'Parça 6');
    expect(p.params).toEqual({ w: 450, h: 320.5, r: 0 });
  });

  test('two-finger pinch with the rectangle tool active zooms and draws nothing', async ({
    page,
  }) => {
    const canvas = await openBoard(page, 390);
    await page.getByTestId('editor-tool-rect').tap();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas box');
    const v0 = await view(canvas);
    const cx = box.x + box.width * 0.5;
    const cy = box.y + box.height * 0.5;
    await touch(canvas, 'pointerdown', 1, cx - 20, cy);
    await touch(canvas, 'pointerdown', 2, cx + 20, cy);
    for (let d = 25; d <= 60; d += 5) {
      await touch(canvas, 'pointermove', 1, cx - d, cy);
      await touch(canvas, 'pointermove', 2, cx + d, cy);
    }
    await touch(canvas, 'pointerup', 1, cx - 60, cy);
    await touch(canvas, 'pointerup', 2, cx + 60, cy);
    const v1 = await view(canvas);
    expect(v1.scale / v0.scale).toBeCloseTo(3, 1);
    await expect(page.getByTestId('editor-canvas')).toHaveAttribute('aria-label', /5 parça/);
    await expect(page.getByTestId('editor-dynamic-input')).toHaveCount(0);
    await expect(page.getByTestId('editor-tool-rect')).toHaveAttribute('aria-pressed', 'true');
    // two-finger pan: both fingers move the same way
    await touch(canvas, 'pointerdown', 1, cx - 30, cy);
    await touch(canvas, 'pointerdown', 2, cx + 30, cy);
    for (let d = 10; d <= 50; d += 10) {
      await touch(canvas, 'pointermove', 1, cx - 30 + d, cy + d);
      await touch(canvas, 'pointermove', 2, cx + 30 + d, cy + d);
    }
    await touch(canvas, 'pointerup', 1, cx + 20, cy + 50);
    await touch(canvas, 'pointerup', 2, cx + 80, cy + 50);
    const v2 = await view(canvas);
    expect(v2.x - v1.x).toBeCloseTo(50, 0);
    expect(v2.y - v1.y).toBeCloseTo(50, 0);
    await expect(page.getByTestId('editor-canvas')).toHaveAttribute('aria-label', /5 parça/);
  });

  test('bend handle works with touch (44 px reach) on a drawn, selected part', async ({ page }) => {
    const canvas = await openBoard(page, 390);
    await saved(page);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas box');
    // tap-tap a rectangle; it is selected after creation
    const a = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.3 };
    const c = { x: box.x + box.width * 0.7, y: box.y + box.height * 0.55 };
    await page.getByTestId('editor-tool-rect').tap();
    await page.touchscreen.tap(a.x, a.y);
    await page.touchscreen.tap(c.x, c.y);
    await expect(canvas).toHaveAttribute('aria-label', /6 parça/);
    await page.getByTestId('editor-tool-select').tap();
    const before = part(await stored(page), 'Parça 6');
    expect(before.kind).toBe('rect');
    // bottom edge middle, touched 16 px off: inside the 22 px touch reach, outside 12 px mouse
    const hx = (a.x + c.x) / 2;
    const hy = c.y + 16;
    await touch(canvas, 'pointerdown', 1, hx, hy);
    for (let d = 5; d <= 30; d += 5) await touch(canvas, 'pointermove', 1, hx, hy + d);
    await touch(canvas, 'pointerup', 1, hx, hy + 30);
    const bent = part(await stored(page), 'Parça 6');
    expect(bent.kind).toBe('freeform');
    expect(bent.outline?.filter((x) => x.bulge !== 0)).toHaveLength(1);
  });
});
