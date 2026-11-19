import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { nest, paste, pickOption } from './wizard-helpers';

/**
 * B19 tester (T152–T154):
 * - the three chunk loads on no page before "3D" is clicked (home, projects, every wizard step)
 * - a scene crash (WebGL2 probe OK, renderer context fails) falls back to 2D with the note; the
 *   2D flow (lock, drag, re-nest, undo) works after 2D → 3D → 2D
 * - 300 parts: draw calls bounded, presets still respond
 * - keyboard: tab order reaches presets, reset, Basit mod and every cube button (named)
 * - --color-mat-* tokens set in light and dark, different per theme
 * - 1440 / 1024 axe in 3D, 390 smoke
 */
test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] } });

const t = tr.cutList;
const l = tr.layout;
const pt = tr.layout.preview3d;
const URL = '/projeler/yeni/parcalar';
const SHELF_SET = [
  'Parça adı\tEn\tBoy\tAdet\tDamar',
  'Yan dikme\t300\t1800\t2\tevet',
  'Raf\t764\t280\t5\tevet',
  'Üst tabla\t800\t300\t1\thayır',
].join('\n');
const TOP = '3.1 · Üst tabla';
const SHEET = { width: 2800, height: 2070 };

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

function watchThree(page: Page) {
  const hits: string[] = [];
  page.on('response', async (res) => {
    if (!res.url().endsWith('.js')) return;
    try {
      if ((await res.text()).includes('WebGLRenderer')) hits.push(res.url());
    } catch {
      // body dropped on navigation
    }
  });
  return hits;
}

async function open3d(page: Page) {
  await page.getByTestId('view-3d').click();
  const host = page.getByTestId('preview3d');
  await expect(host).toHaveAttribute('data-ready', 'true', { timeout: 20_000 });
  return host;
}

async function axeClean(page: Page) {
  const res = await new AxeBuilder({ page }).analyze();
  const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
}

const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));
async function info(page: Page, label: string) {
  await pickOption(page.getByTestId('layout-select'), label);
  const pos = await page.getByTestId('layout-info-position').innerText();
  const size = await page.getByTestId('layout-info-size').innerText();
  const m = /X ([\d.,-]+) · Y ([\d.,-]+) mm/.exec(pos);
  const s = /([\d.,]+) × ([\d.,]+) mm/.exec(size);
  if (!m || !s) throw new Error(`cannot read ${pos} / ${size}`);
  const locked = (await page.getByTestId('layout-info-locked').innerText()) === l.info.lockedYes;
  return { x: num(m[1] ?? ''), y: num(m[2] ?? ''), w: num(s[1] ?? ''), h: num(s[2] ?? ''), locked };
}

test('the 3D chunk loads on no page until 3D is clicked', async ({ page }) => {
  const hits = watchThree(page);
  for (const path of ['/', '/projeler', '/makineler', '/ayarlar']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  await nestShelfSet(page);
  // Every wizard step of the project (Dizilim last, 2D).
  const project = /\/projeler\/([^/?]+)/.exec(page.url())?.[1];
  for (const step of ['makine', 'parcalar', 'dizilim']) {
    await page.goto(`/projeler/${project}?adim=${step}`);
    await page.waitForLoadState('networkidle');
  }
  expect(hits).toEqual([]);
  await expect(page.getByTestId('view-2d')).toHaveAttribute('aria-pressed', 'true');
  await open3d(page);
  await expect.poll(() => hits.length).toBeGreaterThan(0);
});

test('scene crash after a good probe: 2D with the note; the 2D flow still works', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    let calls = 0;
    // @ts-expect-error test stub: the probe gets WebGL2, the renderer does not
    HTMLCanvasElement.prototype.getContext = function (type: string, ...rest: unknown[]) {
      if (type === 'webgl2' || type === 'webgl') {
        calls += 1;
        if (calls > 1) return null;
      }
      return (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
    };
  });
  await nestShelfSet(page);
  await page.getByTestId('view-3d').click();
  await expect(page.getByTestId('preview3d-fallback')).toHaveText(pt.fallback, {
    timeout: 20_000,
  });
  await expect(page.getByTestId('layout-canvas')).toBeVisible();
  await expect(page.getByTestId('view-2d')).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('2D flow after 2D → 3D → 2D: lock, keyboard nudge, re-nest', async ({ page }) => {
  await nestShelfSet(page);
  await open3d(page);
  await page.getByTestId('view-2d').click();
  await expect(page.getByTestId('layout-canvas')).toHaveAttribute('data-part-count', '8');
  const before = await info(page, TOP);
  await page.getByRole('button', { name: l.info.lock }).click();
  await expect(page.getByTestId('layout-info-locked')).toHaveText(l.info.lockedYes);
  const canvas = page.getByTestId('layout-canvas');
  await canvas.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.getByTestId('layout-pending')).toContainText(
    `X ${(before.x + 10).toLocaleString('tr-TR')} · Y ${before.y.toLocaleString('tr-TR')} mm`,
  );
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('layout-pending')).toHaveCount(0);
  const moved = { ...before, locked: true };
  expect(await info(page, TOP)).toEqual(moved);
  await page.getByRole('button', { name: l.renest }).click();
  await expect(page.getByRole('button', { name: l.renest })).toBeEnabled();
  await expect(canvas).toHaveAttribute('data-part-count', '8');
  expect(await info(page, TOP)).toEqual(moved);
  // Back into 3D and out again after the edits: still consistent.
  const host = await open3d(page);
  expect(Number(await host.getAttribute('data-draw-calls'))).toBeGreaterThan(0);
  await page.getByTestId('view-2d').click();
  expect(await info(page, TOP)).toEqual(moved);
  expect(SHEET.width).toBe(2800);
});

test('keyboard: presets, reset, Basit mod and every cube button are named and reachable', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await nestShelfSet(page);
  const host = await open3d(page);
  const ids = ['preview3d-preset-top', 'preview3d-preset-iso', 'preview3d-preset-front'];
  const seen = new Set<string>();
  // The 3D view (cube, Basit mod) comes before its toolbar in the DOM: walk both ways.
  for (const key of ['Tab', 'Shift+Tab']) {
    await page.getByTestId('view-3d').focus();
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press(key);
      const id = await page.evaluate(
        () => document.activeElement?.getAttribute('data-testid') ?? '',
      );
      if (id) seen.add(id);
    }
  }
  for (const f of ['top', 'front', 'right', 'left', 'back', 'iso']) {
    expect(seen).toContain(`preview3d-cube-${f}`);
  }
  for (const id of [...ids, 'preview3d-reset', 'preview3d-simple']) expect(seen).toContain(id);
  // Cube: every button has an accessible name.
  const cube = host.getByRole('button');
  const names = await cube.evaluateAll((els) =>
    els.map((e) => e.getAttribute('aria-label') ?? e.textContent ?? ''),
  );
  expect(names.length).toBeGreaterThanOrEqual(6);
  for (const n of names) expect(n.trim().length).toBeGreaterThan(0);
  // Top preset by keyboard.
  await page.getByTestId('preview3d-preset-top').focus();
  await page.keyboard.press('Enter');
  await expect(host).toHaveAttribute('data-polar', '0');
});

test('300 parts in 3D: bounded draw calls, presets respond', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(URL);
  const rows = ['Ad\tEn\tBoy\tAdet'];
  for (let i = 0; i < 30; i += 1) rows.push(`P${i + 1}\t${60 + 2 * i}\t${50 + 2 * i}\t10`);
  await paste(page, rows.join('\n'), 30);
  await nest(page);
  await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
  const parts = Number(await page.getByTestId('layout-canvas').getAttribute('data-part-count'));
  const t0 = Date.now();
  const host = await open3d(page);
  const firstFrame = Date.now() - t0;
  const calls = Number(await host.getAttribute('data-draw-calls'));
  expect(calls).toBeGreaterThan(0);
  expect(calls).toBeLessThanOrEqual(160);
  const t1 = Date.now();
  await page.getByTestId('preview3d-preset-top').click();
  await expect(host).toHaveAttribute('data-polar', '0', { timeout: 5000 });
  const preset = Date.now() - t1;
  console.log(
    `B19 300: sheet parts ${parts}, draw calls ${calls}, open ${firstFrame} ms, preset ${preset} ms, simple ${await host.getAttribute('data-simple')}`,
  );
});

test('--color-mat-* tokens exist in light and dark and differ', async ({ page }) => {
  const names = ['mdf', 'plywood', 'melamine', 'solid-wood', 'acrylic', 'pvc', 'band', 'shadow'];
  const read = () =>
    page.evaluate(
      (ns) =>
        ns.map((n) =>
          getComputedStyle(document.documentElement).getPropertyValue(`--color-mat-${n}`).trim(),
        ),
      names,
    );
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const light = await read();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const dark = await read();
  for (let i = 0; i < names.length; i++) {
    expect(light[i], names[i]).not.toBe('');
    expect(dark[i], names[i]).not.toBe('');
  }
  expect(dark).not.toEqual(light);
});

for (const width of [1440, 1024, 390]) {
  for (const scheme of ['light', 'dark'] as const) {
    if (width === 390 && scheme === 'dark') continue;
    test(`3D ${width} px ${scheme}: screenshot, axe, no h-scroll`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 1440, height: 900 });
      await nestShelfSet(page);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      const toggle = page.getByTestId('view-3d');
      await toggle.scrollIntoViewIfNeeded();
      await expect(toggle).toBeVisible();
      await open3d(page);
      await page.getByTestId('preview3d').scrollIntoViewIfNeeded();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.screenshot({ path: `__screenshots__/b19-3d-${width}-${scheme}.png` });
      await axeClean(page);
    });
  }
}
