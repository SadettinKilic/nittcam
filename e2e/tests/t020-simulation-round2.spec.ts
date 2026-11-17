import { expect, test, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { goStep, nest, openNewProject, saved, wizardReady } from './wizard-helpers';

/**
 * T020 tester, round 2: persistence under reloads, cursor-anchored zoom, pan clamp, 320 px
 * label/banner layout and tab markers (D-028). Since T023 the project lives on the server and the
 * simulation is step 4 of the wizard; only unsent commands stay in sessionStorage (D-029).
 */
const t = tr.cutList;
const s = tr.simulation;
const PARTS = '/projeler/yeni?adim=parcalar';
/** The unsent-command queue of a project that is not created yet (D-029). */
const KEY = 'nittcam.unsent.new';

const fill = (text: string, v: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));

const KITCHEN = [
  'Parça adı\tEn\tBoy\tAdet\tDamar',
  'Yan\t560\t720\t8\tevet',
  'Taban\t564\t560\t4\thayır',
  'Kapak\t596\t716\t6\tevet',
  'Raf\t564\t520\t8\thayır',
  'Çekmece önü\t596\t176\t4\tevet',
].join('\n');

function watch(page: Page): string[] {
  const p: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') p.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => p.push(`pageerror: ${e.message}`));
  return p;
}

async function paste(page: Page, text = KITCHEN, count = 5) {
  await page.getByRole('button', { name: t.pasteOpen }).click();
  await page.getByLabel(t.paste.textLabel).fill(text);
  await page.getByRole('button', { name: fill(t.paste.applyCount, { count }) }).click();
  await expect(page.getByLabel(t.paste.textLabel)).toHaveCount(0);
}

async function toSimulation(page: Page) {
  await openNewProject(page, 'parcalar');
  await paste(page);
  await nest(page);
  await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
  await goStep(page, 'simulasyon');
}

async function ready(page: Page) {
  const c = page.getByTestId('sim-canvas');
  await expect(c).toBeVisible({ timeout: 30_000 });
  await expect(c).toHaveAttribute('data-scale', /\d/);
  return c;
}

const view = async (c: Locator) => {
  const a = async (k: string) => Number(await c.getAttribute(k));
  return {
    scale: await a('data-scale'),
    x: await a('data-x'),
    y: await a('data-y'),
    w: await a('data-sheet-width'),
    h: await a('data-sheet-height'),
  };
};

/** Visible part of the sheet inside the canvas box, in px per axis. */
const visibleSheet = async (c: Locator) => {
  const box = await c.boundingBox();
  const v = await view(c);
  return {
    x: Math.min(box?.width ?? 0, v.x + v.w * v.scale) - Math.max(0, v.x),
    y: Math.min(box?.height ?? 0, v.y + v.h * v.scale) - Math.max(0, v.y),
  };
};

const hasValue = (page: Page, v: string) =>
  page
    .locator('input')
    .evaluateAll((els, x) => els.some((e) => (e as HTMLInputElement).value === x), v);

async function reloadLayout(page: Page) {
  await page.reload();
  await wizardReady(page, 'dizilim');
  await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 8_000 });
  await expect(page.getByTestId('nesting-sheets')).toHaveText('3');
}

test.describe('T020 round 2: persistence (server since T023)', () => {
  test('Dizilim step: five F5 reloads in a row keep the project and the layout', async ({
    page,
  }) => {
    const problems = watch(page);
    await toSimulation(page);
    await ready(page);
    await saved(page);
    await goStep(page, 'dizilim');
    await expect(page.getByTestId('layout-canvas')).toBeVisible();
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press('F5');
      await page.waitForLoadState('load');
      await wizardReady(page, 'dizilim');
      await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 8_000 });
      await expect(page.getByTestId('nesting-sheets')).toHaveText('3');
    }
    expect(problems).toEqual([]);
  });

  test('layout reload, simulation reload, back and forth keep everything', async ({ page }) => {
    const problems = watch(page);
    await toSimulation(page);
    await ready(page);
    await saved(page);
    for (let i = 0; i < 3; i += 1) {
      await page.reload();
      await wizardReady(page, 'simulasyon');
      await ready(page);
      await goStep(page, 'dizilim');
      await reloadLayout(page);
      await goStep(page, 'simulasyon');
      await ready(page);
      await expect(page.getByTestId('sim-check-status')).toHaveAttribute('data-ok', 'true');
    }
    expect(problems).toEqual([]);
  });

  test('a new project in a fresh tab starts empty without crashing', async ({ page, context }) => {
    await toSimulation(page);
    await ready(page);
    const fresh = await context.newPage();
    const problems = watch(fresh);
    await fresh.goto(PARTS);
    await expect(fresh.getByRole('button', { name: t.pasteOpen })).toBeVisible();
    await expect(fresh.getByTestId('cut-list-count')).toHaveText(
      fill(t.count, { rows: 0, pieces: 0 }),
    );
    await goStep(fresh, 'simulasyon');
    await expect(fresh.getByTestId('sim-empty')).toBeVisible();
    expect(problems).toEqual([]);
    // The first tab is untouched.
    await page.reload();
    await ready(page);
  });

  for (const bad of ['{not json', '{"a":1}', 'null', '[]', '"x"']) {
    test(`corrupted unsent queue ${bad}: empty state, no crash, value replaced`, async ({
      page,
    }) => {
      const problems = watch(page);
      await page.goto(PARTS);
      await wizardReady(page, 'parcalar');
      await page.evaluate(([k, v]) => sessionStorage.setItem(k as string, v as string), [KEY, bad]);
      await page.reload();
      await wizardReady(page, 'parcalar');
      await expect(page.getByRole('button', { name: t.pasteOpen })).toBeVisible();
      await expect(page.getByTestId('cut-list-count')).toHaveText(
        fill(t.count, { rows: 0, pieces: 0 }),
      );
      await paste(page);
      await saved(page);
      // The corrupt value must not survive (T020 intent: the bad value is replaced or removed).
      const stored = await page.evaluate((k) => sessionStorage.getItem(k), KEY);
      expect(stored).not.toBe(bad);
      await page.reload();
      await expect.poll(() => hasValue(page, 'Çekmece önü')).toBe(true);
      expect(problems).toEqual([]);
    });
  }

  test('quick edit then immediate reload keeps the last edit', async ({ page }) => {
    await page.goto(PARTS);
    await wizardReady(page, 'parcalar');
    await paste(page);
    await page.reload();
    await expect.poll(() => hasValue(page, 'Çekmece önü')).toBe(true);
  });
});
test.describe('T020 round 2: zoom and pan', () => {
  for (const w of [1280, 390]) {
    test(`${w} px: wheel zoom keeps the point under the cursor, clamp, fit`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 900 });
      await toSimulation(page);
      const canvas = await ready(page);
      const fit0 = await view(canvas);
      const spots = [
        { fx: 0.05, fy: 0.05 },
        { fx: 0.95, fy: 0.95 },
        { fx: 0.5, fy: 0.3 },
      ];
      for (const sp of spots) {
        await page.getByRole('button', { name: s.controls.fit }).click();
        await canvas.scrollIntoViewIfNeeded();
        const box = await canvas.boundingBox();
        if (!box) throw new Error('no box');
        const before = await view(canvas);
        const px = box.width * sp.fx;
        const py = box.height * sp.fy;
        const sx = (px - before.x) / before.scale;
        const sy = (py - before.y) / before.scale;
        await page.mouse.move(box.x + px, box.y + py);
        for (let i = 0; i < 3; i += 1) await page.mouse.wheel(0, -100);
        await expect
          .poll(async () => (await view(canvas)).scale, { timeout: 3000 })
          .toBeGreaterThan(before.scale * 1.05);
        await page.waitForTimeout(150);
        const after = await view(canvas);
        const ax = (px - after.x) / after.scale;
        const ay = (py - after.y) / after.scale;
        const driftPx = Math.hypot((ax - sx) * after.scale, (ay - sy) * after.scale);
        console.log(
          `${w}px cursor(${sp.fx},${sp.fy}) scale ${before.scale.toFixed(4)}->${after.scale.toFixed(4)} drift ${driftPx.toFixed(2)} px`,
        );
        const inside = sx >= 0 && sy >= 0 && sx <= before.w && sy <= before.h;
        if (inside) expect(driftPx).toBeLessThan(1.5);
      }
      await page.getByRole('button', { name: s.controls.fit }).click();
      for (let i = 0; i < 10; i += 1) {
        await page.getByRole('button', { name: s.controls.zoomIn }).click();
      }
      for (let i = 0; i < 10; i += 1) {
        await page.getByRole('button', { name: s.controls.zoomOut }).click();
      }
      await canvas.scrollIntoViewIfNeeded();
      const box = (await canvas.boundingBox()) ?? { x: 0, y: 0, width: 300, height: 300 };
      const dirs = [
        [5, 5],
        [-4, -4],
        [5, -4],
        [-4, 5],
      ] as const;
      for (const [dx, dy] of dirs) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(
          box.x + box.width / 2 + box.width * dx,
          box.y + box.height / 2 + box.height * dy,
          { steps: 6 },
        );
        await page.mouse.up();
        const v = await visibleSheet(canvas);
        console.log(
          `${w}px after drag (${dx},${dy}) visible ${v.x.toFixed(1)} x ${v.y.toFixed(1)}`,
        );
        expect(v.x).toBeGreaterThanOrEqual(47);
        expect(v.y).toBeGreaterThanOrEqual(47);
      }
      for (let i = 0; i < 10; i += 1) {
        await page.getByRole('button', { name: s.controls.zoomIn }).click();
      }
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x - box.width * 6, box.y - box.height * 6, { steps: 6 });
      await page.mouse.up();
      const far = await visibleSheet(canvas);
      console.log(
        `${w}px zoomed in, dragged far: visible ${far.x.toFixed(1)} x ${far.y.toFixed(1)}`,
      );
      expect(far.x).toBeGreaterThanOrEqual(47);
      expect(far.y).toBeGreaterThanOrEqual(47);
      await page.getByRole('button', { name: s.controls.fit }).click();
      const back = await view(canvas);
      expect(back.scale).toBeCloseTo(fit0.scale, 6);
      expect(back.x).toBeCloseTo(fit0.x, 3);
      expect(back.y).toBeCloseTo(fit0.y, 3);
    });
  }

  test('zoom buttons keep the view centre fixed', async ({ page }) => {
    await toSimulation(page);
    const canvas = await ready(page);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('no box');
    const b = await view(canvas);
    const cx = (box.width / 2 - b.x) / b.scale;
    const cy = (box.height / 2 - b.y) / b.scale;
    for (let i = 0; i < 3; i += 1) {
      await page.getByRole('button', { name: s.controls.zoomIn }).click();
    }
    const a = await view(canvas);
    expect(a.scale).toBeGreaterThan(b.scale * 1.5);
    expect(((box.width / 2 - a.x) / a.scale - cx) * a.scale).toBeCloseTo(0, -0.3);
    expect(((box.height / 2 - a.y) / a.scale - cy) * a.scale).toBeCloseTo(0, -0.3);
  });
});

/** Counts canvas pixels close to a CSS custom property colour; optionally inside a screen rect. */
async function colourPixels(
  canvas: Locator,
  cssVar: string,
  rect?: { x: number; y: number; width: number; height: number },
) {
  return canvas.evaluate(
    (host, args) => {
      const probe = document.createElement('span');
      probe.style.color = `var(${args.cssVar})`;
      host.appendChild(probe);
      const rgb = getComputedStyle(probe).color.match(/\d+/g)?.map(Number) ?? [0, 0, 0];
      probe.remove();
      let n = 0;
      for (const cv of Array.from(host.querySelectorAll('canvas'))) {
        const cb = cv.getBoundingClientRect();
        const k = cv.width / cb.width;
        const d = cv.getContext('2d')?.getImageData(0, 0, cv.width, cv.height);
        if (!d) continue;
        const r = args.rect;
        const x0 = r ? Math.max(0, Math.floor((r.x - cb.left) * k)) : 0;
        const y0 = r ? Math.max(0, Math.floor((r.y - cb.top) * k)) : 0;
        const x1 = r ? Math.min(cv.width, Math.ceil((r.x + r.width - cb.left) * k)) : cv.width;
        const y1 = r ? Math.min(cv.height, Math.ceil((r.y + r.height - cb.top) * k)) : cv.height;
        for (let y = y0; y < y1; y += 1) {
          for (let x = x0; x < x1; x += 1) {
            const i = (y * cv.width + x) * 4;
            if ((d.data[i + 3] ?? 0) < 250) continue;
            if (
              Math.abs((d.data[i] ?? 0) - (rgb[0] ?? 0)) <= 4 &&
              Math.abs((d.data[i + 1] ?? 0) - (rgb[1] ?? 0)) <= 4 &&
              Math.abs((d.data[i + 2] ?? 0) - (rgb[2] ?? 0)) <= 4
            )
              n += 1;
          }
        }
      }
      return n;
    },
    { cssVar, rect },
  );
}

test.describe('T020 round 2: small screens and tabs', () => {
  test('320 px: grain label vs badges, single-line banner, no horizontal scroll', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await toSimulation(page);
    const canvas = await ready(page);
    await page.getByRole('button', { name: s.controls.end }).click();
    const grain = await page.getByTestId('sim-grain').boundingBox();
    const cbox = await canvas.boundingBox();
    if (!grain || !cbox) throw new Error('no boxes');
    expect(grain.x).toBeGreaterThanOrEqual(cbox.x - 0.5);
    expect(grain.x + grain.width).toBeLessThanOrEqual(cbox.x + cbox.width + 0.5);
    expect(grain.width).toBeLessThan(48);
    await expect(page.getByTestId('sim-grain').locator('span.hidden')).toBeHidden();
    const hidden = await colourPixels(canvas, '--color-sim-badge', grain);
    const total = await colourPixels(canvas, '--color-sim-badge');
    console.log(`320px: badge pixels under the grain label ${hidden} of ${total}`);
    expect(total).toBeGreaterThan(0);
    expect(hidden).toBe(0);
    const banner = page.getByTestId('sim-banner');
    await expect(banner).toBeVisible();
    const bb = await banner.boundingBox();
    const lh = await banner.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
    console.log(`320px banner height ${bb?.height} line-height ${lh}`);
    expect(bb?.height ?? 999).toBeLessThanOrEqual(lh + 20);
    expect(bb?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((bb?.x ?? 0) + (bb?.width ?? 999)).toBeLessThanOrEqual(320);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: '__screenshots__/t020-tester-320-r2.png' });
  });

  test('1280 px: grain label with its text does not hide badges either', async ({ page }) => {
    await toSimulation(page);
    const canvas = await ready(page);
    await page.getByRole('button', { name: s.controls.end }).click();
    const grain = await page.getByTestId('sim-grain').boundingBox();
    if (!grain) throw new Error('no grain box');
    const hidden = await colourPixels(canvas, '--color-sim-badge', grain);
    console.log(`1280px: badge pixels under the grain label ${hidden}`);
    expect(hidden).toBe(0);
  });

  test('tab markers are drawn at fit-to-screen for the kitchen sample', async ({ page }) => {
    await toSimulation(page);
    const canvas = await ready(page);
    await expect(page.getByTestId('sim-summary-tabs')).not.toHaveText('0');
    const atStart = await colourPixels(canvas, '--color-sim-tab');
    await page.getByRole('button', { name: s.controls.end }).click();
    await page.getByRole('button', { name: s.controls.fit }).click();
    await expect(canvas).not.toHaveAttribute('data-done', '0');
    const atEnd = await colourPixels(canvas, '--color-sim-tab');
    console.log(`tab-colour pixels: start ${atStart}, end (fit) ${atEnd}`);
    expect(atEnd).toBeGreaterThan(atStart);
    expect(atEnd).toBeGreaterThan(20);
    await canvas.screenshot({ path: '__screenshots__/t020-tester-tabs-fit.png' });
  });
});
