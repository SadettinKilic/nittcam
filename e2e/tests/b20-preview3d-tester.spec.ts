import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { goStep, openNewProject, pasteAndNest } from './wizard-helpers';

/** B20 tester (T156/T157): sync with the G-code panel, axe and a 390 px smoke on the 3D simulation. */
test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] } });
// T159: the real frame watch never downgrades the view on the CPU-rendered runner (fps.ts); the
// slow chain is driven by the __nittcam3dSlow hook where a test needs it.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __nittcam3dNoAuto: boolean }).__nittcam3dNoAuto = true;
  });
});

async function open3d(page: import('@playwright/test').Page) {
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page);
  await goStep(page, 'simulasyon');
  await expect(page.getByTestId('sim-canvas')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('sim-view-3d').click();
  const host = page.getByTestId('preview3d');
  await expect(host).toHaveAttribute('data-ready', 'true', { timeout: 15_000 });
  return host;
}

test('T157: scrubbing moves the G-code panel line and the 3D player; axe clean', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const host = await open3d(page);
  const canvas = page.getByTestId('sim-canvas');
  const panel = page.getByTestId('gcode-panel');
  const scrubber = page.getByTestId('sim-scrubber');
  const max = Number(await scrubber.getAttribute('max'));

  await scrubber.fill('0');
  const l0 = await panel.getAttribute('data-current-line');
  await scrubber.fill(String(Math.round(max * 0.6)));
  const t1 = await canvas.getAttribute('data-time');
  const l1 = await panel.getAttribute('data-current-line');
  expect(l1).not.toBe(l0);
  // Return to 2D: same time and same line as seen from 3D.
  await page.getByTestId('sim-view-2d').click();
  await expect(canvas).toHaveAttribute('data-time', t1 ?? '');
  await expect(panel).toHaveAttribute('data-current-line', l1 ?? '');
  await page.getByTestId('sim-view-3d').click();
  await expect(host).toHaveAttribute('data-ready', 'true', { timeout: 15_000 });
  await expect(panel).toHaveAttribute('data-current-line', l1 ?? '');

  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
    [],
  );
});

test('T156: 390 px smoke: 3D simulation, no page-level horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open3d(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.getByTestId('sim-banner-3d')).toBeVisible();
});
