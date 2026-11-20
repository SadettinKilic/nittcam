import { expect, test, type Page } from '@playwright/test';
import tr from '../../../apps/web/messages/tr.json' with { type: 'json' };
import { goStep, nest, openNewProject, pasteAndNest } from '../wizard-helpers';
import { applyTheme, expectNoA11yViolations, snap, snapElement } from './helpers';

/**
 * T161 (spec §11): the 3D test suite. Fixture screenshots (top + iso) of the sheet, the cabinet
 * assembly and the simulation after playing to the end; the 2D fallback; axe on the 3D controls.
 * WebGL is CPU-rendered (SwiftShader), so captures are the same run to run; no frame-rate
 * assertions here (those live in b21-preview3d-perf.spec.ts behind PERF_BUDGET=1). Only the 3D
 * host is captured, at 1440 light (desktop-first, D-043); scene building, camera, picking and
 * playback maths are unit tests in apps/web/lib/preview3d.
 */
test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] } });

const sim = tr.simulation;

async function ready3d(page: Page) {
  const host = page.getByTestId('preview3d');
  await expect(host).toHaveAttribute('data-ready', 'true', { timeout: 20_000 });
  // No hover highlight in the captures.
  await page.mouse.move(0, 0);
  return host;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await applyTheme(page, 'light');
  // The frame-rate watch (D-033) would turn on Basit mod, then 2D, on a CPU-rendered canvas
  // during playback; the T159 test switch keeps the normal 3D view in the captures. The slow
  // chain itself is covered in b21-preview3d-perf.spec.ts.
  await page.addInitScript(() => {
    (window as unknown as { __nittcam3dNoAuto: boolean }).__nittcam3dNoAuto = true;
  });
});

test('sheet fixture: top and iso', async ({ page }) => {
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page);
  await page.getByTestId('view-3d').click();
  const host = await ready3d(page);
  await expect(host).toHaveAttribute('data-view', 'iso');
  await expect(host).toHaveAttribute('data-azimuth', '45');
  await snapElement(page, host, 't161-3d-sheet-iso');

  await page.getByTestId('preview3d-preset-top').click();
  await expect(host).toHaveAttribute('data-polar', '0');
  await page.mouse.move(0, 0);
  await snapElement(page, host, 't161-3d-sheet-top');
  await expectNoA11yViolations(page);
});

test('cabinet fixture: assembly view', async ({ page }) => {
  await openNewProject(page, 'parcalar');
  await page.getByTestId('cabinet-open').click();
  await page.getByTestId('cabinet-add').click();
  await expect(page.getByTestId('cabinet-dialog')).toHaveCount(0);
  await nest(page);
  await page.getByTestId('view-3d').click();
  const host = await ready3d(page);
  await page.getByTestId('preview3d-assembly').click();
  await expect(host).toHaveAttribute('data-assembly', /Dolap 1:/);
  await expect(page.getByTestId('preview3d-assembly-canvas')).toBeVisible();
  await page.mouse.move(0, 0);
  await snapElement(page, host, 't161-3d-assembly-iso');
  await expectNoA11yViolations(page);
});

test.describe('simulation playback', () => {
  // Playback is off under reduced motion (it steps instead), so this test plays with motion on.
  test.use({ reducedMotion: 'no-preference' });

  test.setTimeout(90_000);
  test('3D playback runs to the end; toolpath fixture at the end', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openNewProject(page, 'parcalar');
    await pasteAndNest(page);
    await goStep(page, 'simulasyon');
    const canvas = page.getByTestId('sim-canvas');
    await expect(canvas).toBeVisible({ timeout: 30_000 });
    const duration = Number(await canvas.getAttribute('data-duration'));
    expect(duration).toBeGreaterThan(0);

    await page.getByTestId('sim-view-3d').click();
    const host = await ready3d(page);
    await expect(host).toHaveAttribute('data-toolpath', 'on');
    await page.getByRole('button', { name: sim.controls.speedMax }).click();
    await page.getByTestId('sim-play').click();
    // "En hızlı" plays a sheet in ~10 s of wall time; SwiftShader frames are slow but the clock
    // advances by real time, so the end is reached in about the same time.
    await expect
      .poll(async () => Number(await canvas.getAttribute('data-time')), { timeout: 40_000 })
      .toBe(duration);
    await expect(page.getByTestId('sim-play')).toHaveAccessibleName(sim.controls.play);
    await expectNoA11yViolations(page);

    // Still the 3D view (no slow fallback), camera on the iso diagonal after the intro.
    await expect(page.getByTestId('sim-view-3d')).toHaveAttribute('aria-pressed', 'true');
    await expect(host).toHaveAttribute('data-azimuth', '45');
    await page.mouse.move(0, 0);
    await snapElement(page, host, 't161-3d-sim-end-iso');
    // The tools row (with Takım yolu) leaves the presets free to click (T161 overlap fix).
    await page.getByTestId('preview3d-preset-top').click({ timeout: 5_000 });
    await expect(host).toHaveAttribute('data-polar', '0');
    await page.mouse.move(0, 0);
    await snapElement(page, host, 't161-3d-sim-end-top');
  });
});

test('without WebGL2: 2D with the Turkish note, axe clean', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    // @ts-expect-error test stub: pretend the browser has no WebGL2
    HTMLCanvasElement.prototype.getContext = function (type: string, ...rest: unknown[]) {
      if (type === 'webgl2') return null;
      return (original as (...a: unknown[]) => unknown).call(this, type, ...rest);
    };
  });
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page);
  await page.getByTestId('view-3d').click();
  await expect(page.getByTestId('preview3d-fallback')).toHaveText(tr.layout.preview3d.fallback);
  await expect(page.getByTestId('preview3d')).toHaveCount(0);
  await expect(page.getByTestId('layout-canvas')).toBeVisible();
  await expectNoA11yViolations(page);
  // Review capture only: the page around the note carries the project's save state.
  await snap(page, 't161-3d-fallback', { fullPage: false, baseline: false });
});
