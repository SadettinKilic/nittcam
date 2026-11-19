import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { nest } from './wizard-helpers';

/**
 * B19 (T152–T154): 3D preview on Dizilim. Geometry is unit-tested as data
 * (apps/web/lib/preview3d); here only mount, lazy loading, controls and the 2D fallback.
 * WebGL runs on SwiftShader in headless Chromium.
 */
test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] } });

const t = tr.cutList;
const pt = tr.layout.preview3d;
const URL = '/projeler/yeni/parcalar';
const SHELF_SET = [
  'Parça adı\tEn\tBoy\tAdet\tDamar',
  'Yan dikme\t300\t1800\t2\tevet',
  'Raf\t764\t280\t5\tevet',
  'Üst tabla\t800\t300\t1\thayır',
].join('\n');

const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));

async function nestShelfSet(page: Page) {
  await page.goto(URL);
  await page.getByRole('button', { name: t.pasteOpen }).click();
  await page.getByLabel(t.paste.textLabel).fill(SHELF_SET);
  await page.getByRole('button', { name: fill(t.paste.applyCount, { count: 3 }) }).click();
  await nest(page);
  await expect(page.getByTestId('layout-canvas')).toHaveAttribute('data-part-count', '8');
}

/** Watches JS responses; `three` is recognised by its renderer class name. */
function watchThree(page: Page): { loaded: () => boolean } {
  let seen = false;
  page.on('response', async (res) => {
    if (!res.url().endsWith('.js')) return;
    try {
      if ((await res.text()).includes('WebGLRenderer')) seen = true;
    } catch {
      // navigation can drop a body; ignore
    }
  });
  return { loaded: () => seen };
}

async function open3d(page: Page) {
  await page.getByTestId('view-3d').click();
  const host = page.getByTestId('preview3d');
  await expect(host).toBeVisible();
  await expect(host).toHaveAttribute('data-ready', 'true', { timeout: 15_000 });
  return host;
}

test('3D chunk is lazy, mounts in the canvas slot and eases to isometric', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const three = watchThree(page);
  await nestShelfSet(page);
  await expect(page.getByTestId('view-2d')).toHaveAttribute('aria-pressed', 'true');
  expect(three.loaded()).toBe(false);

  const host = await open3d(page);
  expect(three.loaded()).toBe(true);
  await expect(page.getByTestId('view-3d')).toHaveAttribute('aria-pressed', 'true');
  await expect(host.locator('canvas')).toBeVisible();
  await expect(host).toHaveAttribute('data-view', 'iso');
  // After the ≤ 400 ms intro the camera sits on the isometric diagonal.
  await expect(host).toHaveAttribute('data-azimuth', '45');
  await expect(host).toHaveAttribute('data-polar', '55');
  // The 2D tools and legend give way to the 3D presets; the plate tabs stay.
  await expect(page.getByTestId('layout-legend-button')).toBeHidden();
  await expect(page.getByTestId('preview3d-preset-top')).toBeVisible();
  await expect(page.getByTestId('sheet-tabs-scroll')).toBeVisible();
  expect(Number(await host.getAttribute('data-draw-calls'))).toBeGreaterThan(0);

  // Back to 2D: the Konva view is still there.
  await page.getByTestId('view-2d').click();
  await expect(page.getByTestId('preview3d')).toHaveCount(0);
  await expect(page.getByTestId('layout-canvas')).toBeVisible();
  expect(errors).toEqual([]);
});

test('presets, view cube, reset and orbit drag move the camera', async ({ page }) => {
  await nestShelfSet(page);
  const host = await open3d(page);

  await page.getByTestId('preview3d-preset-top').click();
  await expect(host).toHaveAttribute('data-polar', '0');
  await page.getByTestId('preview3d-preset-front').click();
  await expect(host).toHaveAttribute('data-polar', '88'); // orbit limit keeps above the table
  await expect(host).toHaveAttribute('data-azimuth', '0');

  // The cube faces are buttons (keyboard reachable).
  const right = page.getByRole('button', {
    name: fill(pt.presetTip, { view: pt.presets.right }),
    exact: true,
  });
  await right.focus();
  await page.keyboard.press('Enter');
  await expect(host).toHaveAttribute('data-azimuth', '90');

  await page.getByTestId('preview3d-reset').click();
  await expect(host).toHaveAttribute('data-azimuth', '45');

  // Mouse orbit: a horizontal drag turns the camera around the sheet.
  const box = await host.boundingBox();
  if (!box) throw new Error('no box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 160, cy, { steps: 8 });
  await page.mouse.up();
  await expect(host).not.toHaveAttribute('data-azimuth', '45');

  // Wheel zoom changes the distance.
  const before = Number(await host.getAttribute('data-distance'));
  await page.mouse.wheel(0, -400);
  await expect
    .poll(async () => Number(await host.getAttribute('data-distance')))
    .toBeLessThan(before);
});

test('reduced motion: no intro ease, presets jump', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await nestShelfSet(page);
  const host = await open3d(page);
  await expect(host).toHaveAttribute('data-reduced-motion', 'true');
  await expect(host).toHaveAttribute('data-azimuth', '45');
  await page.getByTestId('preview3d-preset-top').click();
  await expect(host).toHaveAttribute('data-polar', '0', { timeout: 500 });
});

test('without WebGL2 the view stays 2D with a Turkish note', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    // @ts-expect-error test stub: pretend the browser has no WebGL2
    HTMLCanvasElement.prototype.getContext = function (type: string, ...rest: unknown[]) {
      if (type === 'webgl2') return null;
      return (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
    };
  });
  await nestShelfSet(page);
  await page.getByTestId('view-3d').click();
  await expect(page.getByTestId('preview3d-fallback')).toHaveText(pt.fallback);
  await expect(page.getByTestId('preview3d')).toHaveCount(0);
  await expect(page.getByTestId('layout-canvas')).toBeVisible();
  await expect(page.getByTestId('view-2d')).toHaveAttribute('aria-pressed', 'true');
});

test('Basit mod: flat colours without shadows, remembered, cheaper to draw', async ({ page }) => {
  await nestShelfSet(page);
  const host = await open3d(page);
  await expect(host).toHaveAttribute('data-simple', 'false');
  await page.getByTestId('preview3d-preset-top').click();
  await expect(host).toHaveAttribute('data-polar', '0');
  const full = Number(await host.getAttribute('data-draw-calls'));
  await page.getByTestId('preview3d-simple').click();
  await expect(page.getByTestId('preview3d-simple')).toHaveAttribute('aria-pressed', 'true');
  await expect(host).toHaveAttribute('data-simple', 'true');
  // A camera change renders a frame with the simple materials (no contact-shadow passes).
  await page.getByTestId('preview3d-preset-iso').click();
  await expect(host).toHaveAttribute('data-azimuth', '45');
  await expect
    .poll(async () => Number(await host.getAttribute('data-draw-calls')))
    .toBeLessThan(full);
  // Remembered when the 3D view opens again.
  await page.getByTestId('view-2d').click();
  await open3d(page);
  await expect(page.getByTestId('preview3d')).toHaveAttribute('data-simple', 'true');
});

/** Tabs of the plate strip that are fully inside it. */
async function fullTabs(page: Page): Promise<number> {
  const strip = page.getByTestId('sheet-tabs-scroll');
  const sb = await strip.boundingBox();
  if (!sb) return 0;
  let n = 0;
  for (const tab of await strip.getByRole('tab').all()) {
    const tb = await tab.boundingBox();
    if (tb && tb.x >= sb.x - 0.5 && tb.x + tb.width <= sb.x + sb.width + 0.5) n += 1;
  }
  return n;
}

test('the 2D/3D switch keeps the tab row (T249): ≥ 3 full tabs at 1440, a full first tab at 1024', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(URL);
  await page.getByRole('button', { name: t.pasteOpen }).click();
  await page
    .getByLabel(t.paste.textLabel)
    .fill(['Parça adı\tEn\tBoy\tAdet\tDamar', 'Büyük\t1300\t1000\t40\thayır'].join('\n'));
  await page.getByRole('button', { name: fill(t.paste.applyCount, { count: 1 }) }).click();
  await nest(page);
  await expect(page.getByTestId('sheet-tabs-scroll').getByRole('tab')).toHaveCount(10, {
    timeout: 20_000,
  });
  expect(await fullTabs(page)).toBeGreaterThanOrEqual(3);
  await open3d(page);
  expect(await fullTabs(page)).toBeGreaterThanOrEqual(3);
  await page.setViewportSize({ width: 1024, height: 800 });
  await expect.poll(() => fullTabs(page)).toBeGreaterThanOrEqual(1);
  await page.getByTestId('view-2d').click();
  await expect.poll(() => fullTabs(page)).toBeGreaterThanOrEqual(1);
});
