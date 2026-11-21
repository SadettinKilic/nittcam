import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { optionLabels, pickOption, nest as runDiz } from './wizard-helpers';

/** T013 tester: margin edge, refusals, undo/redo, keyboard, locks, tabs, zoom mapping, mobile. */

const t = tr.cutList;
const p = t.paste;
const l = tr.layout;
const URL = '/projeler/yeni/parcalar';
/** Draft sheet 2800 × 2070, margin 10, clearance 0.1 (T313, D-104), example tool 8 mm → spacing 8.1 mm. */
const SHEET = { width: 2800, height: 2070 };
const MARGIN = 10;

const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}

const SHELF_SET = [
  'Parça adı\tEn\tBoy\tAdet\tDamar',
  'Yan dikme\t300\t1800\t2\tevet',
  'Raf\t764\t280\t5\tevet',
  'Üst tabla\t800\t300\t1\thayır',
].join('\n');

const KITCHEN = [
  'Parça adı\tEn\tBoy\tAdet\tDamar',
  'Yan\t560\t720\t8\tevet',
  'Taban\t564\t560\t4\thayır',
  'Kapak\t596\t716\t6\tevet',
  'Raf\t564\t520\t8\thayır',
  'Çekmece önü\t596\t176\t4\tevet',
].join('\n');

async function paste(page: Page, text: string, count: number) {
  await page.getByRole('button', { name: t.pasteOpen }).click();
  await page.getByLabel(p.textLabel).fill(text);
  await page.getByRole('button', { name: fill(p.applyCount, { count }) }).click();
  await expect(page.getByLabel(p.textLabel)).toHaveCount(0);
}

async function nest(page: Page, text: string, count: number, parts: string) {
  await page.goto(URL);
  await paste(page, text, count);
  await runDiz(page);
  await expect(page.getByTestId('layout-canvas')).toHaveAttribute('data-part-count', parts);
  await expect(page.locator('[data-testid=layout-canvas] canvas').first()).toBeVisible();
}

const nestShelf = (page: Page) => nest(page, SHELF_SET, 3, '8');

const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

async function info(page: Page, label: string): Promise<Box & { locked: boolean }> {
  await pickOption(page.getByTestId('layout-select'), label);
  const pos = await page.getByTestId('layout-info-position').innerText();
  const size = await page.getByTestId('layout-info-size').innerText();
  const m = /X ([\d.,-]+) · Y ([\d.,-]+) mm/.exec(pos);
  const s = /([\d.,]+) × ([\d.,]+) mm/.exec(size);
  if (!m || !s) throw new Error(`cannot read ${pos} / ${size}`);
  const locked = (await page.getByTestId('layout-info-locked').innerText()) === l.info.lockedYes;
  return { x: num(m[1] ?? ''), y: num(m[2] ?? ''), w: num(s[1] ?? ''), h: num(s[2] ?? ''), locked };
}

async function view(page: Page) {
  const box = page.getByTestId('layout-canvas');
  const canvas = await page.locator('[data-testid=layout-canvas] canvas').first().boundingBox();
  if (!canvas) throw new Error('no canvas');
  return {
    scale: Number(await box.getAttribute('data-scale')),
    vx: Number(await box.getAttribute('data-x')),
    vy: Number(await box.getAttribute('data-y')),
    cx: canvas.x,
    cy: canvas.y,
  };
}

/** Screen point of a sheet point (mm, origin bottom-left, Y up). */
async function screen(page: Page, xmm: number, ymm: number) {
  const v = await view(page);
  return { x: v.cx + v.vx + xmm * v.scale, y: v.cy + v.vy + (SHEET.height - ymm) * v.scale };
}

/** Sheet point (mm) under a screen point. */
async function sheetPoint(page: Page, px: number, py: number) {
  const v = await view(page);
  return { x: (px - v.cx - v.vx) / v.scale, y: SHEET.height - (py - v.cy - v.vy) / v.scale };
}

const centre = (b: Box) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
const TOP = '3.1 · Üst tabla';

async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 5, from.y + 5, { steps: 2 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

/** Drags the top panel so its bottom-left lands near (x, y) mm. */
async function dragTopTo(page: Page, before: Box, x: number, y: number) {
  const a = await screen(page, centre(before).x, centre(before).y);
  const b = await screen(page, x + before.w / 2, y + before.h / 2);
  await dragTo(page, a, b);
}

const message = (page: Page) => page.getByTestId('layout-message');

test.describe('T013 tester: margin edge', () => {
  test('a drop in the margin is refused, one just inside the usable area is accepted; exact limit by keyboard', async ({
    page,
  }) => {
    const problems = watchConsole(page);
    await nestShelf(page);
    const before = await info(page, TOP);
    const right = SHEET.width - MARGIN - before.w; // 1990: exact right usable limit
    await page.getByTestId('layout-canvas').scrollIntoViewIfNeeded();

    // 1) drop inside the right margin band (right edge ~5 mm past the limit: mid-band, so one
    //    screen pixel of rounding on the T197 workspace canvas still lands in the band)
    await dragTopTo(page, before, right + 5, 900);
    await expect(message(page)).toHaveAttribute('role', 'alert');
    await expect(message(page)).toContainText(fill(l.drop.inMargin, { margin: MARGIN }));
    expect(await info(page, TOP)).toEqual(before);

    // 2) drop just inside the usable area: accepted and locked
    await dragTopTo(page, before, right - 6, 900);
    await expect(message(page)).toContainText('kilitlendi');
    const inside = await info(page, TOP);
    expect(inside.locked).toBe(true);
    expect(inside.x).toBeLessThanOrEqual(right);
    expect(inside.x).toBeGreaterThanOrEqual(right - 14);

    // 3) keyboard: nudge to the exact limit (accepted), one more mm is refused
    const canvas = page.getByTestId('layout-canvas');
    await canvas.focus();
    for (let i = 0; i < right - inside.x; i += 1) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    expect((await info(page, TOP)).x).toBe(right);
    await canvas.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(message(page)).toContainText(fill(l.drop.inMargin, { margin: MARGIN }));
    expect((await info(page, TOP)).x).toBe(right);
    // off the sheet entirely
    await canvas.focus();
    for (let i = 0; i < 20; i += 1) await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Enter');
    await expect(message(page)).toContainText(l.drop.outsideSheet);
    expect((await info(page, TOP)).x).toBe(right);
    expect(problems).toEqual([]);
  });

  test('left margin: exact 10 mm accepted, 9 mm refused (keyboard)', async ({ page }) => {
    await nestShelf(page);
    const before = await info(page, TOP);
    await page.getByTestId('layout-canvas').scrollIntoViewIfNeeded();
    // Park in free space at the right first, then walk it to the far bottom-right corner.
    await dragTopTo(page, before, SHEET.width - MARGIN - before.w - 8, 900);
    await expect(message(page)).toContainText('kilitlendi');
    const canvas = page.getByTestId('layout-canvas');
    const cur = await info(page, TOP);
    await canvas.focus();
    // bottom edge: move down to y = MARGIN exactly (Shift = 10 mm, then 1 mm)
    const dy = cur.y - MARGIN;
    for (let i = 0; i < Math.floor(dy / 10); i += 1) await page.keyboard.press('Shift+ArrowDown');
    for (let i = 0; i < dy % 10; i += 1) await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    expect((await info(page, TOP)).y).toBe(MARGIN);
    await canvas.focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(message(page)).toContainText(fill(l.drop.inMargin, { margin: MARGIN }));
    expect((await info(page, TOP)).y).toBe(MARGIN);
  });
});

test.describe('T013 tester: refusals and undo/redo', () => {
  test('drag onto another part: Turkish role=alert, position unchanged, no undo step added', async ({
    page,
  }) => {
    const problems = watchConsole(page);
    await nestShelf(page);
    const shelf = await info(page, '2.1 · Raf');
    const before = await info(page, TOP);
    await page.getByTestId('layout-canvas').scrollIntoViewIfNeeded();
    // undo is available (the nesting); redo is not
    await expect(page.getByTestId('wizard-undo')).toBeEnabled();
    const a = await screen(page, centre(before).x, centre(before).y);
    const b = await screen(page, centre(shelf).x, centre(shelf).y);
    await dragTo(page, a, b);
    const alert = page.locator('p[role=alert]', { hasText: 'Buraya bırakılamaz' });
    await expect(alert).toHaveCount(1);
    await expect(alert).toContainText('2.1');
    await expect(alert).toContainText("8,1 mm'den yakın");
    expect(await info(page, TOP)).toEqual(before);
    // the single undo step is still the nesting: one click removes the whole layout
    await page.getByTestId('wizard-undo').click();
    await expect(page.getByTestId('layout-canvas')).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('valid drop, undo, redo', async ({ page }) => {
    const problems = watchConsole(page);
    await nestShelf(page);
    const before = await info(page, TOP);
    await page.getByTestId('layout-canvas').scrollIntoViewIfNeeded();
    const sp = await spot(page, before);
    await dragTopTo(page, before, sp.x, sp.y);
    await expect(message(page)).toContainText('kilitlendi');
    const moved = await info(page, TOP);
    expect(moved.locked).toBe(true);
    expect(moved).not.toEqual(before);
    await page.getByTestId('wizard-undo').click();
    expect(await info(page, TOP)).toEqual(before);
    await page.getByRole('button', { name: t.redo }).click();
    expect(await info(page, TOP)).toEqual(moved);
    expect(problems).toEqual([]);
  });

  test('Esc cancels, Enter commits; Shift nudges 10 mm, plain nudge 1 mm; Up is +Y', async ({
    page,
  }) => {
    await nestShelf(page);
    const before = await info(page, TOP);
    await page.getByTestId('layout-canvas').scrollIntoViewIfNeeded();
    const sp = await spot(page, before);
    await dragTopTo(page, before, sp.x, sp.y);
    await expect(message(page)).toContainText('kilitlendi');
    const start = await info(page, TOP);
    const canvas = page.getByTestId('layout-canvas');
    await canvas.focus();
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId('layout-pending')).toContainText(
      `X ${(start.x + 20).toLocaleString('tr-TR')} · Y ${(start.y - 1).toLocaleString('tr-TR')} mm`,
    );
    await page.keyboard.press('Escape');
    expect(await info(page, TOP)).toEqual(start);
    await canvas.focus();
    await page.keyboard.press('Shift+ArrowUp');
    await page.keyboard.press('Enter');
    expect(await info(page, TOP)).toEqual({ ...start, y: start.y + 10 });
  });
});

test.describe('T013 tester: locks and re-nest', () => {
  test('lock keeps the part on re-nest; unlock then re-nest moves it back', async ({ page }) => {
    await nestShelf(page);
    const before = await info(page, TOP);
    await page.getByTestId('layout-canvas').scrollIntoViewIfNeeded();
    const sp = await spot(page, before);
    await dragTopTo(page, before, sp.x, sp.y);
    await expect(message(page)).toContainText('kilitlendi');
    const locked = await info(page, TOP);
    await page.getByRole('button', { name: l.renest }).click();
    await expect(page.getByRole('button', { name: l.renest })).toBeEnabled();
    expect(await info(page, TOP)).toEqual(locked);

    await page.getByRole('button', { name: l.info.unlock }).click();
    await expect(page.getByTestId('layout-info-locked')).toHaveText(l.info.lockedNo);
    await page.getByRole('button', { name: l.renest }).click();
    await expect(page.getByRole('button', { name: l.renest })).toBeEnabled();
    await expect(page.getByTestId('layout-canvas')).toHaveAttribute('data-part-count', '8');
    const after = await info(page, TOP);
    expect(after.locked).toBe(false);
    expect([after.x, after.y]).not.toEqual([locked.x, locked.y]);
    // the placer is deterministic: with no locks it reproduces the first layout
    expect([after.x, after.y]).toEqual([before.x, before.y]);
  });
});

test.describe('T013 tester: sheet tabs', () => {
  test('every sheet tab carries its waste %; plate part counts add up', async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto(URL);
    await paste(page, KITCHEN, 5);
    await runDiz(page);
    const tabs = page.getByRole('tab');
    // T313 (D-104): with tool + 0.1 mm the kitchen set needs 2 sheets (3 with the old 16 mm).
    await expect(tabs).toHaveCount(2);
    const sums: number[] = [];
    for (let i = 0; i < 2; i += 1) {
      const tab = tabs.nth(i);
      await tab.click();
      await expect(tab).toHaveAttribute('aria-selected', 'true');
      const tabText = await tab.innerText();
      const tabWaste = /fire %([\d.,]+)/.exec(tabText)?.[1];
      // T249: the tabs carry the per-plate waste once (no per-plate lines in the left panel).
      expect(tabWaste, tabText).toMatch(/^\d+(,\d)?$/);
      sums.push(Number(await page.getByTestId('layout-canvas').getAttribute('data-part-count')));
    }
    expect(sums.reduce((a, b) => a + b, 0)).toBe(30);
    expect(problems).toEqual([]);
  });
});

test.describe('T013 tester: zoom', () => {
  test('buttons zoom in/out/fit; wheel keeps the sheet point under the cursor; drag maps after zoom', async ({
    page,
  }) => {
    const problems = watchConsole(page);
    await nestShelf(page);
    const canvasBox = page.getByTestId('layout-canvas');
    await canvasBox.scrollIntoViewIfNeeded();

    // fit: whole sheet visible inside the canvas
    const fit = await view(page);
    const bb = await canvasBox.boundingBox();
    expect(fit.scale * SHEET.width).toBeLessThanOrEqual((bb?.width ?? 0) + 1);
    await page.getByRole('button', { name: l.zoomIn }).click();
    const zin = Number(await canvasBox.getAttribute('data-scale'));
    expect(zin).toBeGreaterThan(fit.scale);
    await page.getByRole('button', { name: l.zoomOut }).click();
    await page.getByRole('button', { name: l.zoomOut }).click();
    expect(Number(await canvasBox.getAttribute('data-scale'))).toBeLessThan(fit.scale);
    await page.getByRole('button', { name: l.fit }).click();
    expect(Number(await canvasBox.getAttribute('data-scale'))).toBeCloseTo(fit.scale, 5);

    // park the top panel in free space at the right, then zoom with the wheel over it
    const top = await info(page, TOP);
    const sp = await spot(page, top);
    await dragTopTo(page, top, sp.x, sp.y);
    await expect(message(page)).toContainText('kilitlendi');
    const parked = await info(page, TOP);
    const c = await screen(page, centre(parked).x, centre(parked).y);
    const mmBefore = await sheetPoint(page, c.x, c.y);
    await page.mouse.move(c.x, c.y);
    for (let i = 0; i < 4; i += 1) await page.mouse.wheel(0, -120);
    await expect.poll(async () => (await view(page)).scale).toBeGreaterThan(fit.scale * 1.5);
    const mmAfter = await sheetPoint(page, c.x, c.y);
    const zs = (await view(page)).scale;
    expect(Math.abs(mmAfter.x - mmBefore.x) * zs).toBeLessThan(1.5);
    expect(Math.abs(mmAfter.y - mmBefore.y) * zs).toBeLessThan(1.5);

    // drag by +60 px right, -40 px (up on screen = +Y) in the zoomed view
    const z = await view(page);
    await dragTo(page, c, { x: c.x + 60, y: c.y - 40 });
    await expect(message(page)).toContainText('kilitlendi');
    const dropped = await info(page, TOP);
    const expectDx = 60 / z.scale;
    const expectDy = 40 / z.scale;
    expect(Math.abs(dropped.x - parked.x - expectDx)).toBeLessThanOrEqual(2.5);
    expect(Math.abs(dropped.y - parked.y - expectDy)).toBeLessThanOrEqual(2.5);
    expect(problems).toEqual([]);
  });
});

test.describe('T013 tester: layout on small screens', () => {
  for (const width of [320, 390]) {
    test(`${width} px: no page-level horizontal scroll (also after zoom and a refused drop)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await nestShelf(page);
      await page.getByRole('button', { name: l.zoomIn }).click();
      await page.getByRole('button', { name: l.zoomIn }).click();
      await page.getByRole('button', { name: l.fit }).click();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const box = await page.getByTestId('layout-canvas').boundingBox();
      expect(box && box.x + box.width).toBeLessThanOrEqual(width);
    });
  }
});

test.describe('T013 tester: mobile touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('the page scrolls past the canvas when it has room; otherwise the canvas fills ≥ 55 %', async ({
    page,
  }) => {
    await nestShelf(page);
    const canvas = page.getByTestId('layout-canvas');
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    const vh = await page.evaluate(() => window.innerHeight);
    const share = box ? box.height / vh : 1;
    console.log(
      `canvas ${box?.width}x${box?.height} px, viewport h ${vh}: ${(share * 100).toFixed(1)} %`,
    );
    // T240 (D-039, intentional): the phone workspace now fits the viewport when it can, with the
    // canvas card ≥ 55 % of the height. Then there is no page scroll to test; the canvas share is
    // the check. The page-scroll checks below run only when the page has room to scroll.
    const room = await page.evaluate(
      () => document.documentElement.scrollHeight - window.innerHeight,
    );
    if (room <= 10) {
      const card = await page.getByTestId('layout-workspace-canvas').boundingBox();
      expect((card?.height ?? 0) / vh).toBeGreaterThanOrEqual(0.55);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
      return;
    }
    expect(share).toBeLessThan(0.6);

    const cdp = await page.context().newCDPSession(page);
    const swipe = async (x: number, y: number, dist: number) => {
      const to = y - dist;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let i = 1; i <= 10; i += 1) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x, y: y + ((to - y) * i) / 10 }],
        });
        await page.waitForTimeout(16);
      }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const scrollY = () => page.evaluate(() => window.scrollY);

    // A swipe that starts on the page text, outside the canvas, scrolls the page.
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid=layout-canvas]');
      if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 20);
    });
    const y0 = await scrollY();
    const cb = await canvas.boundingBox();
    console.log(
      `scrollY ${y0}, canvas top in viewport ${cb?.y}, bottom ${(cb?.y ?? 0) + (cb?.height ?? 0)}`,
    );
    // finger down on page text ABOVE the canvas: the page scrolls up
    await swipe(40, Math.max(15, Math.round((cb?.y ?? 100) / 2)), -250);
    await expect.poll(scrollY).toBeLessThan(y0 - 30);
    // finger up on text BELOW the canvas (legend): the page scrolls down again
    await canvas.scrollIntoViewIfNeeded();
    const y2 = await scrollY();
    const cb2 = await canvas.boundingBox();
    await swipe(40, Math.round((cb2?.y ?? 0) + (cb2?.height ?? 0) + 20), 200);
    await expect.poll(scrollY).toBeGreaterThan(y2 + 30);

    // Documented behaviour: a swipe that starts on the canvas does not scroll the page.
    await canvas.scrollIntoViewIfNeeded();
    const b2 = await canvas.boundingBox();
    const y1 = await scrollY();
    await swipe(
      Math.round((b2?.x ?? 0) + 195),
      Math.round((b2?.y ?? 0) + (b2?.height ?? 0) / 2),
      150,
    );
    await page.waitForTimeout(300);
    console.log(`swipe on canvas moved page by ${(await scrollY()) - y1} px`);

    // There is always page area beside/below the canvas to grab: the canvas never fills the screen.
    const below = await page.evaluate(() => {
      const el = document.querySelector('[data-testid=layout-canvas]');
      return el
        ? document.documentElement.scrollHeight - el.getBoundingClientRect().bottom - window.scrollY
        : 0;
    });
    expect(below).toBeGreaterThan(0);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('T013 tester: Turkish strings', () => {
  test('layout section text has no English UI words; source has no literal labels', async ({
    page,
  }) => {
    await nestShelf(page);
    const section = page.locator('section[aria-labelledby=layout-title]');
    const text = await section.innerText();
    const labels = await section
      .locator('[aria-label],[title]')
      .evaluateAll((els) =>
        els.map((e) => `${e.getAttribute('aria-label') ?? ''} ${e.getAttribute('title') ?? ''}`),
      );
    const all = `${text} ${labels.join(' ')}`;
    for (const word of [
      /\bLock\b/i,
      /\bUnlock\b/i,
      /\bZoom\b/i,
      /\bSheet\b/i,
      /\bWaste\b/i,
      /\bFit\b/i,
      /\bUndo\b/i,
      /\bCancel\b/i,
      /\bposition\b/i,
      /\bdrag\b/i,
    ]) {
      expect(all).not.toMatch(word);
    }
    // every fixed heading comes from tr.json
    expect(text).toContain(l.title);

    const dir = join(process.cwd(), '..', 'apps', 'web', 'components', 'layout-view');
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.tsx'))) {
      const src = readFileSync(join(dir, file), 'utf8');
      expect(src, file).not.toMatch(/aria-label="[^"{]*[A-Za-z]{3,}/);
      expect(src, file).not.toMatch(/title="[^"{]*[A-Za-z]{3,}/);
      expect(src, file).not.toMatch(/>\s*[A-ZÇĞİÖŞÜ][a-zçğıöşü]{2,}[^<>{}]*</);
    }
  });
});

/** A free bottom-left spot for the top panel, clear of every other part by 36 mm. */
async function spot(page: Page, own: Box): Promise<{ x: number; y: number }> {
  const labels = (await optionLabels(page.getByTestId('layout-select'))).filter(
    (o) => o !== l.selectNone && o !== TOP,
  );
  const others: Box[] = [];
  for (const label of labels) others.push(await info(page, label));
  await pickOption(page.getByTestId('layout-select'), TOP);
  const clear = 36;
  for (let y = 600; y + own.h <= SHEET.height - MARGIN - clear; y += 10) {
    for (let x = 1000; x + own.w <= SHEET.width - MARGIN - clear; x += 10) {
      const ok = others.every(
        (o) =>
          x + own.w + clear <= o.x ||
          o.x + o.w + clear <= x ||
          y + own.h + clear <= o.y ||
          o.y + o.h + clear <= y,
      );
      if (ok && Math.abs(x - own.x) > 50) return { x, y };
    }
  }
  throw new Error('no free spot');
}
