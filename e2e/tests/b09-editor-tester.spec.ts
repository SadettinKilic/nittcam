import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  KITCHEN,
  KITCHEN_3,
  goStep,
  openNewProject,
  paste,
  pasteAndNest,
  saved,
  toastsSettled,
} from './wizard-helpers';

// B9 tester (T124–T126, T199b): what the dev specs leave out. Redo, persistence after reload,
// click hit-testing at three zoom levels, multi-part paste offsets, rotate about the centre,
// one-finger pan and pinch about the midpoint, grid-only snap, keyboard path + axe in both
// themes, 390 px, and the plate-tab strips with many plates.

const trNum = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

async function openBoard(page: Page, width = 1440): Promise<Locator> {
  await page.setViewportSize({ width, height: width > 600 ? 900 : 844 });
  await openNewProject(page, 'parcalar');
  await paste(page, KITCHEN, 5);
  await page.getByTestId('parts-view-drawing').click();
  const canvas = page.getByTestId('editor-canvas');
  await expect(canvas).toHaveAttribute('data-view', /\d/);
  await toastsSettled(page); // the paste toast fades in; axe would read it mid-fade
  return canvas;
}

async function view(canvas: Locator) {
  const [scale = 0, x = 0, y = 0] = ((await canvas.getAttribute('data-view')) ?? '')
    .split(',')
    .map(Number);
  return { scale, x, y };
}

async function readPart(page: Page) {
  const pos = (await page.getByTestId('editor-position').textContent()) ?? '';
  const size = (await page.getByTestId('editor-size').textContent()) ?? '';
  const p = /X\s*(-?[\d.,]+)\s*·\s*Y\s*(-?[\d.,]+)/.exec(pos);
  const s = /([\d.,]+)\s*×\s*([\d.,]+)/.exec(size);
  return {
    x: trNum(p?.[1] ?? 'NaN'),
    y: trNum(p?.[2] ?? 'NaN'),
    w: trNum(s?.[1] ?? 'NaN'),
    h: trNum(s?.[2] ?? 'NaN'),
  };
}

const listButton = (page: Page, name: string) =>
  page.getByTestId('editor-part-list').getByRole('button', { name, exact: true });

async function select(page: Page, name: string) {
  await listButton(page, name).click();
  await page.getByTestId('editor-canvas').focus();
}

/** Screen point (page coordinates) of a board point. */
async function toScreen(canvas: Locator, at: { x: number; y: number }) {
  const v = await view(canvas);
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas box');
  return { x: box.x + v.x + at.x * v.scale, y: box.y + v.y - at.y * v.scale };
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

test.describe('B9 tester: editing (T125)', () => {
  test('Ctrl+Y and Ctrl+Shift+Z redo a board move undone with Ctrl+Z', async ({ page }) => {
    await openBoard(page);
    await select(page, 'Taban');
    const p0 = await readPart(page);
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(() => readPart(page)).toEqual({ ...p0, x: p0.x + 10 });
    await page.keyboard.press('Control+z');
    await expect.poll(() => readPart(page)).toEqual(p0);
    await page.keyboard.press('Control+y');
    await expect.poll(() => readPart(page)).toEqual({ ...p0, x: p0.x + 10 });
    await page.keyboard.press('Control+z');
    await expect.poll(() => readPart(page)).toEqual(p0);
    await page.keyboard.press('Control+Shift+z');
    await expect.poll(() => readPart(page)).toEqual({ ...p0, x: p0.x + 10 });
  });

  test('board positions survive Liste ↔ Çizim and a page reload', async ({ page }) => {
    await openBoard(page);
    // Let the first save create the project, then (re)open Çizim so the URL carries the view.
    await saved(page);
    await page.getByTestId('parts-view-list').click();
    await page.getByTestId('parts-view-drawing').click();
    await select(page, 'Raf');
    const p0 = await readPart(page);
    await page.keyboard.press('Shift+ArrowUp');
    await page.keyboard.press('Shift+ArrowUp');
    await page.keyboard.press('ArrowLeft');
    const moved = { ...p0, x: p0.x - 1, y: p0.y + 20 };
    await expect.poll(() => readPart(page)).toEqual(moved);
    await page.getByTestId('parts-view-list').click();
    await page.getByTestId('parts-view-drawing').click();
    await select(page, 'Raf');
    await expect.poll(() => readPart(page)).toEqual(moved);
    await saved(page);
    await page.reload();
    await expect(page).toHaveURL(/gorunum=cizim/);
    await expect(page.getByTestId('editor-canvas')).toHaveAttribute('data-view', /\d/);
    await select(page, 'Raf');
    await expect.poll(() => readPart(page)).toEqual(moved);
  });

  test('the first save of a new project keeps ?gorunum=cizim in the URL', async ({ page }) => {
    // Bug: project-wizard `created()` rewrites the URL with stepUrl(id, step) and drops the view,
    // so a reload after the first save opens "Liste" instead of "Çizim".
    await openBoard(page);
    await expect(page).toHaveURL(/gorunum=cizim/);
    await saved(page);
    await expect(page).toHaveURL(/\/projeler\/[0-9a-f-]{36}/);
    await expect(page).toHaveURL(/gorunum=cizim/);
    // Round 2: a reload reopens Çizim, and another step does not inherit a stale view param.
    await page.reload();
    await expect(page.getByTestId('editor-canvas')).toHaveAttribute('data-view', /\d/);
    await expect(page).toHaveURL(/adim=parcalar/);
    await goStep(page, 'dizilim');
    await expect(page).toHaveURL(/adim=dizilim/);
    expect(page.url()).not.toContain('gorunum=');
  });

  test('Ctrl+A, Ctrl+C, Ctrl+V: every copy keeps its offset (+20, −20) to its original', async ({
    page,
  }) => {
    await openBoard(page);
    const names = ['Yan', 'Taban', 'Kapak', 'Raf', 'Çekmece önü'];
    const before = new Map<string, Awaited<ReturnType<typeof readPart>>>();
    for (const n of names) {
      await select(page, n);
      before.set(n, await readPart(page));
    }
    await page.keyboard.press('Control+a');
    await expect(page.getByTestId('editor-inspector')).toContainText('5');
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await expect(page.getByTestId('editor-part-list').getByRole('button')).toHaveCount(10);
    for (const n of names) {
      const copy = tr.editor.copyName.replace('{name}', n);
      await select(page, copy);
      const b = before.get(n);
      if (!b) throw new Error(n);
      await expect.poll(() => readPart(page)).toEqual({ ...b, x: b.x + 20, y: b.y - 20 });
    }
    // Originals did not move.
    await select(page, 'Yan');
    expect(await readPart(page)).toEqual(before.get('Yan'));
  });

  test('rotate turns about the centre; four turns and two mirrors restore the part', async ({
    page,
  }) => {
    await openBoard(page);
    await select(page, 'Çekmece önü');
    const p0 = await readPart(page);
    const centre = { x: p0.x + p0.w / 2, y: p0.y + p0.h / 2 };
    await page.keyboard.press('Shift+R');
    await expect.poll(() => readPart(page).then((p) => [p.w, p.h])).toEqual([p0.h, p0.w]);
    const p1 = await readPart(page);
    expect(p1.x + p1.w / 2).toBeCloseTo(centre.x, 1);
    expect(p1.y + p1.h / 2).toBeCloseTo(centre.y, 1);
    for (let i = 0; i < 3; i += 1) await page.keyboard.press('Shift+R');
    await expect.poll(() => readPart(page)).toEqual(p0);
    await page.keyboard.press('Shift+X');
    await page.keyboard.press('Shift+X');
    await page.keyboard.press('Shift+Y');
    await page.keyboard.press('Shift+Y');
    await expect.poll(() => readPart(page)).toEqual(p0);
    // Eight commands, eight undo steps back to the start (one more would undo the paste).
    for (let i = 0; i < 8; i += 1) await page.keyboard.press('Control+z');
    await expect.poll(() => readPart(page)).toEqual(p0);
  });

  test('click selects the part under the cursor at three zoom levels', async ({ page }) => {
    const canvas = await openBoard(page);
    await select(page, 'Kapak');
    const k = await readPart(page);
    await page.keyboard.press('Escape');
    await expect(listButton(page, 'Kapak')).toHaveAttribute('aria-pressed', 'false');
    for (const key of ['', '+', '-']) {
      if (key) for (let i = 0; i < 2; i += 1) await page.keyboard.press(key);
      // Fit first for the zoomed-in case so Kapak stays on screen.
      if (key === '+') {
        await page.keyboard.press('f');
        await page.keyboard.press('+');
      }
      // A point 10 % inside Kapak's lower-left corner.
      const at = await toScreen(canvas, { x: k.x + k.w * 0.1, y: k.y + k.h * 0.1 });
      await page.mouse.click(at.x, at.y);
      await expect(listButton(page, 'Kapak')).toHaveAttribute('aria-pressed', 'true');
      await page.keyboard.press('Escape');
      await expect(listButton(page, 'Kapak')).toHaveAttribute('aria-pressed', 'false');
    }
  });

  test('keys typed into a field never edit the board', async ({ page }) => {
    await openBoard(page);
    await select(page, 'Yan');
    const p0 = await readPart(page);
    // Any text field on the page (the wizard project name).
    const field = page.locator('input[type="text"], input:not([type]), textarea').first();
    test.skip((await field.count()) === 0, 'no text field on the Parts step');
    await field.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+R');
    await page.keyboard.press('Delete');
    await expect(page.getByTestId('editor-part-list').getByRole('button')).toHaveCount(5);
    expect(await readPart(page)).toEqual(p0);
  });

  test('Ctrl+C with nothing selected leaves the native copy alone', async ({ page }) => {
    await openBoard(page);
    await page.getByTestId('editor-canvas').focus();
    await page.keyboard.press('Escape');
    const prevented = await page.evaluate(() => {
      const ev = new KeyboardEvent('keydown', {
        key: 'c',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      document.body.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    expect(prevented).toBe(false);
  });

  test('Ctrl+V with an empty board clipboard and Ctrl+D with nothing selected stay native', async ({
    page,
  }) => {
    await openBoard(page);
    const canvas = page.getByTestId('editor-canvas');
    await canvas.focus();
    await page.keyboard.press('Escape');
    const keys = (list: string[]) =>
      canvas.evaluate(
        (el, ks) =>
          ks.map((key) => {
            const ev = new KeyboardEvent('keydown', {
              key,
              ctrlKey: true,
              bubbles: true,
              cancelable: true,
            });
            el.dispatchEvent(ev);
            return ev.defaultPrevented;
          }),
        list,
      );
    expect(await keys(['v', 'd', 'c'])).toEqual([false, false, false]);
    await expect(page.getByTestId('editor-part-list').getByRole('button')).toHaveCount(5);
    // With a selection the board still owns copy and paste.
    await select(page, 'Raf');
    expect(await keys(['c', 'v'])).toEqual([true, true]);
    await expect(page.getByTestId('editor-part-list').getByRole('button')).toHaveCount(6);
  });
});

test.describe('B9 tester: view and snap (T124, T126)', () => {
  test('one finger on empty board pans by the finger distance', async ({ page }) => {
    const canvas = await openBoard(page, 390);
    for (let i = 0; i < 4; i += 1) await page.keyboard.press('-');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas box');
    const v0 = await view(canvas);
    // Bottom-right area is empty after zooming out (parts grow from the origin).
    const s = { x: box.x + box.width - 60, y: box.y + box.height - 80 };
    await touch(canvas, 'pointerdown', 1, s.x, s.y);
    for (let i = 1; i <= 5; i += 1) await touch(canvas, 'pointermove', 1, s.x - i * 8, s.y - i * 6);
    await touch(canvas, 'pointerup', 1, s.x - 40, s.y - 30);
    const v1 = await view(canvas);
    expect(v1.scale).toBeCloseTo(v0.scale, 6);
    expect(v1.x - v0.x).toBeCloseTo(-40, 0);
    expect(v1.y - v0.y).toBeCloseTo(-30, 0);
  });

  test('pinch keeps the board point under the finger midpoint fixed', async ({ page }) => {
    const canvas = await openBoard(page, 390);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas box');
    const v0 = await view(canvas);
    const mid = { x: box.width * 0.4, y: box.height * 0.6 };
    const world0 = { x: (mid.x - v0.x) / v0.scale, y: (v0.y - mid.y) / v0.scale };
    const cx = box.x + mid.x;
    const cy = box.y + mid.y;
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
    const world1 = { x: (mid.x - v1.x) / v1.scale, y: (v1.y - mid.y) / v1.scale };
    expect(world1.x).toBeCloseTo(world0.x, 0);
    expect(world1.y).toBeCloseTo(world0.y, 0);
  });

  test('with only grid snap on, a dragged corner lands on the grid', async ({ page }) => {
    const canvas = await openBoard(page);
    await page.getByTestId('editor-snap-menu').click();
    for (const k of ['endpoint', 'midpoint', 'centre', 'intersection', 'perpendicular', 'angle']) {
      const box = page.getByRole('checkbox', { name: tr.editor.snap[k as 'grid'], exact: true });
      if ((await box.getAttribute('aria-checked')) === 'true') await box.click();
    }
    await expect(page.getByTestId('editor-snap-menu')).toContainText('1');
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-radix-popper-content-wrapper]')).toHaveCount(0);
    await select(page, 'Kapak');
    const p0 = await readPart(page);
    const v = await view(canvas);
    const from = await toScreen(canvas, { x: p0.x + p0.w / 2, y: p0.y + p0.h / 2 });
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 37.3, from.y - 23.7, { steps: 6 });
    await page.mouse.up();
    const p1 = await readPart(page);
    expect(p1).not.toEqual(p0);
    // Fine grid at this zoom is ≥ 1 mm and the corner sits on a node of it.
    const fine = [1, 10, 100, 1000].find((g) => g * v.scale >= 8) ?? 1;
    const corners = [
      [p1.x, p1.y],
      [p1.x + p1.w, p1.y],
      [p1.x, p1.y + p1.h],
      [p1.x + p1.w, p1.y + p1.h],
    ];
    const onGrid = corners.some(
      ([x = 0, y = 0]) =>
        Math.abs(x / fine - Math.round(x / fine)) < 1e-6 &&
        Math.abs(y / fine - Math.round(y / fine)) < 1e-6,
    );
    expect(onGrid, JSON.stringify({ p1, fine })).toBe(true);
  });

  test('keyboard path: tool rail is reachable, V/H switch tools, F fits', async ({ page }) => {
    const canvas = await openBoard(page);
    const selTool = page.getByTestId('editor-tool-select');
    const pan = page.getByTestId('editor-tool-pan');
    await expect(selTool).toHaveAttribute('aria-pressed', 'true');
    await canvas.focus();
    await page.keyboard.press('h');
    await expect(pan).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('v');
    await expect(selTool).toHaveAttribute('aria-pressed', 'true');
    await pan.focus();
    await page.keyboard.press('Enter');
    await expect(pan).toHaveAttribute('aria-pressed', 'true');
    await expect(pan).toHaveAttribute('aria-keyshortcuts', 'H');
    const start = await view(canvas);
    await page.keyboard.press('v');
    await canvas.focus();
    await page.keyboard.press('+');
    await page.keyboard.press('+');
    await expect.poll(async () => (await view(canvas)).scale).toBeGreaterThan(start.scale);
    await page.keyboard.press('f');
    await expect.poll(async () => (await view(canvas)).scale).toBeCloseTo(start.scale, 4);
  });

  for (const scheme of ['light', 'dark'] as const) {
    for (const width of [1440, 390]) {
      test(`axe and no horizontal scroll: drawing board ${width} px ${scheme}`, async ({
        page,
      }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await openBoard(page, width);
        if (width > 600) await select(page, 'Yan');
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

/** 40 large parts: four per 2800 × 2070 sheet → 10 plates, more tabs than fit at 1440. */
const BIG = ['Parça adı\tEn\tBoy\tAdet\tDamar', 'Büyük\t1300\t1000\t40\thayır'].join('\n');

test.describe('B9 tester: plate tabs (T199b)', () => {
  test('1440: many plates scroll; the last tab is reachable and fully visible', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'parcalar');
    await pasteAndNest(page, BIG, 1);
    const strip = page.getByTestId('sheet-tabs-scroll');
    const tabs = strip.getByRole('tab');
    const n = await tabs.count();
    expect(n).toBeGreaterThanOrEqual(6);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const overflowing = await strip.getAttribute('data-overflow-end');
    // Keyboard: focus the first tab, arrow to the last; the selected tab scrolls into view.
    await tabs.first().click();
    for (let i = 1; i < n; i += 1) {
      await page.keyboard.press('ArrowRight');
      // Radix moves roving focus in a timeout: wait for it before the next key.
      await expect(tabs.nth(i)).toBeFocused();
    }
    const last = tabs.last();
    await expect(last).toHaveAttribute('data-state', 'active');
    const sb = await strip.boundingBox();
    const lb = await last.boundingBox();
    if (!sb || !lb) throw new Error('boxes');
    expect(lb.x).toBeGreaterThanOrEqual(sb.x - 0.5);
    expect(lb.x + lb.width).toBeLessThanOrEqual(sb.x + sb.width + 0.5);
    if (overflowing) {
      await expect(strip).toHaveAttribute('data-overflow-start', 'true');
      await expect(strip).not.toHaveAttribute('data-overflow-end', 'true');
      // A vertical wheel over the strip scrolls it sideways (back to the start).
      await strip.hover();
      for (let i = 0; i < 10; i += 1) await page.mouse.wheel(0, -400);
      await expect(strip).not.toHaveAttribute('data-overflow-start', 'true');
    }
  });

  async function visibleTabs(strip: Locator) {
    const sb = await strip.boundingBox();
    if (!sb) throw new Error('strip box');
    let visible = 0;
    for (const tab of await strip.getByRole('tab').all()) {
      const tb = await tab.boundingBox();
      if (tb && tb.x >= sb.x - 0.5 && tb.x + tb.width <= sb.x + sb.width + 0.5) visible += 1;
    }
    return visible;
  }

  for (const scheme of ['light', 'dark'] as const) {
    test(`1440 ${scheme}, both panels open, 10 plates: tabs and tools share one row (T249), ≥ 3 tabs fully visible`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 1440, height: 900 });
      await openNewProject(page, 'parcalar');
      await pasteAndNest(page, BIG, 1);
      await expect(page.getByTestId('layout-panel')).toBeVisible();
      await expect(page.getByTestId('layout-canvas')).toHaveAttribute('data-scale', /[0-9]/);
      const strip = page.getByTestId('sheet-tabs-scroll');
      expect(await strip.getByRole('tab').count()).toBeGreaterThanOrEqual(10);
      const canvasW = (await page.getByTestId('layout-canvas').boundingBox())?.width ?? 0;
      const visible = await visibleTabs(strip);
      test
        .info()
        .annotations.push({ type: 'tabs', description: `canvas ${canvasW}px, ${visible} visible` });
      expect(visible).toBeGreaterThanOrEqual(3);
      // T249 (D-040): from 1024 px the tools share the tab row, whatever the canvas width.
      const overlap = await strip.evaluate((el) => {
        const r = el.getBoundingClientRect();
        // The strip may sit in a wrapper (T287 unplaced chip); look up to 3 levels for the tools row.
        let node: Element = el;
        for (let i = 0; i < 3 && node.parentElement; i++) {
          const parent: Element = node.parentElement;
          const self = node;
          const n = [...parent.children]
            .filter((c) => c !== self)
            .map((c) => c.getBoundingClientRect())
            .filter((b) => b.width > 0 && b.top < r.bottom - 1 && b.bottom > r.top + 1).length;
          if (n > 0) return n;
          node = parent;
        }
        return 0;
      });
      expect(overlap).toBeGreaterThan(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: `__screenshots__/b09-r2-tabs-1440-${scheme}.png` });
    });
  }

  test('1440, both panels collapsed (wide canvas), 10 plates: tabs share the row, ≥ 3 fully visible (T244 r2)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'parcalar');
    await pasteAndNest(page, BIG, 1);
    await expect(page.getByTestId('layout-canvas')).toHaveAttribute('data-scale', /[0-9]/);
    for (const side of ['left', 'right'] as const) {
      const panel = page.getByTestId(`workspace-${side}`);
      if ((await panel.getAttribute('data-state')) !== 'closed') {
        await page.getByTestId(`workspace-${side}-toggle`).click();
        await expect(panel).toHaveAttribute('data-state', 'closed');
      }
    }
    await expect
      .poll(async () => (await page.getByTestId('layout-canvas').boundingBox())?.width ?? 0)
      .toBeGreaterThanOrEqual(768);
    const strip = page.getByTestId('sheet-tabs-scroll');
    await expect.poll(() => visibleTabs(strip)).toBeGreaterThanOrEqual(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `__screenshots__/b06-r2-tabs-wide-1440.png` });
  });

  test('390: Dizilim tabs: ≥ 2 fully visible, strip inside the viewport, light and dark', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openNewProject(page, 'parcalar');
    await pasteAndNest(page, BIG, 1);
    await expect(page.getByTestId('layout-canvas')).toHaveAttribute('data-scale', /[0-9]/);
    const strip = page.getByTestId('sheet-tabs-scroll');
    const sb = await strip.boundingBox();
    if (!sb) throw new Error('strip box');
    expect(sb.x + sb.width).toBeLessThanOrEqual(390 + 0.5);
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.screenshot({ path: `__screenshots__/b09-r2-tabs-390-${scheme}.png` });
    }
    const widths = await strip
      .getByRole('tab')
      .evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
    // Each tab carries its waste (≈ 126 px); at 390 two fit fully and the third peeks (scrollable).
    expect(widths.every((w) => w <= 140)).toBe(true);
    expect(await visibleTabs(strip)).toBeGreaterThanOrEqual(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });

  test('390: simulation plate tabs sit on their own row, like Dizilim', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openNewProject(page, 'parcalar');
    await pasteAndNest(page, KITCHEN_3, 5);
    const layoutStrip = page.getByTestId('sheet-tabs-scroll');
    await expect(layoutStrip.getByRole('tab')).toHaveCount(3);
    await goStep(page, 'simulasyon');
    const strip = page.getByTestId('sim-tabs-scroll');
    await expect(strip.getByRole('tab')).toHaveCount(3);
    const sb = await strip.boundingBox();
    if (!sb) throw new Error('strip box');
    // Own row: nothing else on the page shares the strip's vertical band inside its parent row.
    const siblings = await strip.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const parent = el.parentElement;
      if (!parent) return [];
      return [...parent.children]
        .filter((c) => c !== el)
        .map((c) => c.getBoundingClientRect())
        .filter((b) => b.width > 0 && b.height > 0 && b.top < r.bottom - 1 && b.bottom > r.top + 1)
        .map((b) => ({ left: b.left, right: b.right }));
    });
    expect(siblings).toEqual([]);
    expect(sb.x + sb.width).toBeLessThanOrEqual(390 + 0.5);
    for (const tab of await strip.getByRole('tab').all()) {
      await tab.click();
      await expect(tab).toHaveAttribute('data-state', 'active');
      const tb = await tab.boundingBox();
      if (!tb) throw new Error('tab box');
      expect(tb.x + tb.width).toBeLessThanOrEqual(sb.x + sb.width + 0.5);
      expect(tb.x).toBeGreaterThanOrEqual(sb.x - 0.5);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
});
