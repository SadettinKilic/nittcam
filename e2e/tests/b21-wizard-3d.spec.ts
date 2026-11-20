import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { goStep, nest, openNewProject, paste } from './wizard-helpers';

/** B21 T160: 2D / 3D in the wizard's sheet step, the camera kept across steps, PNG export. */
test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] } });
// T159: the real frame watch never downgrades the view on the CPU-rendered runner (fps.ts); the
// slow chain is driven by the __nittcam3dSlow hook where a test needs it.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __nittcam3dNoAuto: boolean }).__nittcam3dNoAuto = true;
  });
});

test('sheet step 3D, camera kept on the way to Dizilim, "Görüntü kaydet" downloads a PNG', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'makine');
  const panel = page.getByTestId('sheet-preview');
  await panel.getByTestId('view-3d').click();
  const host = panel.getByTestId('preview3d');
  await expect(host).toHaveAttribute('data-ready', 'true', { timeout: 20_000 });
  await host.getByTestId('preview3d-preset-front').click();
  await expect(host).toHaveAttribute('data-polar', '88');
  await expect(host).toHaveAttribute('data-azimuth', '0');

  await panel.screenshot({ path: test.info().outputPath('sheet-3d.png') });
  // PNG of the visible frame.
  const download = page.waitForEvent('download');
  await host.getByTestId('preview3d-save-png').click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('nittcam-plaka-1-3d.png');
  const bytes = readFileSync(await file.path());
  expect(bytes.subarray(1, 4).toString()).toBe('PNG');
  expect(bytes.length).toBeGreaterThan(2000);

  // Step tabs: Parçalar → Dizilim opens in 3D with the same camera (no intro ease to isometric).
  await goStep(page, 'parcalar');
  await paste(page, ['Parça adı\tEn\tBoy\tAdet', 'Raf\t600\t300\t4'].join('\n'), 1);
  await nest(page);
  const layoutHost = page.getByTestId('preview3d');
  await expect(layoutHost).toHaveAttribute('data-ready', 'true', { timeout: 20_000 });
  await expect(page.getByTestId('view-3d')).toHaveAttribute('aria-pressed', 'true');
  await expect(layoutHost).toHaveAttribute('data-polar', '88');
  await expect(layoutHost).toHaveAttribute('data-azimuth', '0');

  // Back to 2D in Dizilim → the sheet step opens in 2D too.
  await page.getByTestId('view-2d').click();
  await goStep(page, 'makine');
  await expect(page.getByTestId('sheet-preview').getByTestId('view-2d')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
