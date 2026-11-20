import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { nest } from './wizard-helpers';

/**
 * B21 T159: 3D performance budget and Basit mod. The host exposes the perf read-out as data
 * attributes (data-fps, data-first-frame-ms, data-gpu-geometries, data-gpu-textures).
 * Headless Chromium draws on SwiftShader (CPU), so the 45 fps orbit budget is only asserted with
 * PERF_BUDGET=1 on a machine with a GPU (the "mid laptop" reference); here it is logged.
 */
test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] } });

const t = tr.cutList;
const pt = tr.layout.preview3d;
const URL = '/projeler/yeni/parcalar';
const BUDGET = process.env.PERF_BUDGET === '1';

const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));

/** 300 parts in three shapes (100 each). */
const SET_300 = [
  'Parça adı\tEn\tBoy\tAdet\tDamar',
  'Kapak\t150\t100\t100\thayır',
  'Çekmece önü\t120\t80\t100\thayır',
  'Kulp altlığı\t100\t60\t100\thayır',
].join('\n');

async function nest300(page: Page) {
  await page.goto(URL);
  await page.getByRole('button', { name: t.pasteOpen }).click();
  await page.getByLabel(t.paste.textLabel).fill(SET_300);
  await page.getByRole('button', { name: fill(t.paste.applyCount, { count: 3 }) }).click();
  await nest(page);
  await expect(page.getByTestId('layout-canvas')).toBeVisible();
}

async function open3d(page: Page) {
  await page.getByTestId('view-3d').click();
  const host = page.getByTestId('preview3d');
  await expect(host).toHaveAttribute('data-ready', 'true', { timeout: 20_000 });
  return host;
}

/** Orbits with a slow mouse drag for about `ms` and returns the last run's frame rate. */
async function orbit(page: Page, ms: number): Promise<number> {
  const box = await page.getByTestId('preview3d-canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  const steps = Math.round(ms / 16);
  for (let i = 0; i < steps; i++) {
    await page.mouse.move(cx + Math.sin(i / 20) * 200, cy + Math.cos(i / 30) * 40);
  }
  const fps = Number(await page.getByTestId('preview3d').getAttribute('data-fps'));
  await page.mouse.up();
  return fps;
}

test('300 parts: first frame within 1.5 s, frame rate read out while orbiting', async ({
  page,
}) => {
  test.slow();
  await nest300(page);
  const host = await open3d(page);
  const first = Number(await host.getAttribute('data-first-frame-ms'));
  expect(first).toBeGreaterThan(0);
  expect(first).toBeLessThanOrEqual(1500);
  const fps = await orbit(page, 1500);
  console.log(`[perf] 300 parts: first frame ${first} ms, orbit ${fps} fps`);
  expect(fps).toBeGreaterThan(0);
  if (BUDGET) expect(fps).toBeGreaterThanOrEqual(45);
});

test('GPU memory stays flat while orbiting and switching presets', async ({ page }) => {
  test.slow();
  await nest300(page);
  const host = await open3d(page);
  const read = async () => ({
    g: Number(await host.getAttribute('data-gpu-geometries')),
    x: Number(await host.getAttribute('data-gpu-textures')),
  });
  await orbit(page, 500);
  const start = await read();
  for (let i = 0; i < 6; i++) {
    await page.getByTestId('preview3d-preset-top').click();
    await page.getByTestId('preview3d-reset').click();
    await page.getByTestId('preview3d-simple').click(); // material rebuild on every toggle
    await orbit(page, 300);
  }
  const end = await read();
  expect(end.g).toBeLessThanOrEqual(start.g + 2);
  expect(end.x).toBeLessThanOrEqual(start.x + 2);
});

test('slow frames: Basit mod turns on by itself, still slow → 2D with a note', async ({ page }) => {
  await nest300(page);
  const host = await open3d(page);
  await expect(host).toHaveAttribute('data-simple', 'false');
  // Test hook: the frame watch sees a 10 fps clock.
  await page.evaluate(() => {
    (window as unknown as { __nittcam3dSlow?: number }).__nittcam3dSlow = 10;
  });
  await page.getByTestId('preview3d-preset-top').click();
  await expect(page.getByTestId('preview3d-auto-simple')).toHaveText(pt.simpleAuto);
  await expect(host).toHaveAttribute('data-simple', 'true');
  // Still slow in Basit mod → the 2D view with its own note (spec §3.8).
  await expect(page.getByTestId('preview3d-fallback')).toHaveText(pt.fallbackSlow);
  await expect(page.getByTestId('preview3d')).toHaveCount(0);
  await expect(page.getByTestId('view-2d')).toHaveAttribute('aria-pressed', 'true');
});

test('the canvas caps the pixel ratio at 2', async ({ browser }) => {
  const ctx = await browser.newContext({ deviceScaleFactor: 3 });
  const page = await ctx.newPage();
  await nest300(page);
  await open3d(page);
  const ratio = await page.getByTestId('preview3d-canvas').evaluate((el) => {
    const c = el.querySelector('canvas');
    if (!c) return 0;
    return c.width / c.getBoundingClientRect().width;
  });
  expect(ratio).toBeGreaterThan(0);
  expect(ratio).toBeLessThanOrEqual(2.01);
  await ctx.close();
});
