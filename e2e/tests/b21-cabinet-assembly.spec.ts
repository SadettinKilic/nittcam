import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { fill, nest, openNewProject } from './wizard-helpers';

/** B21 T158: "Montaj görünümü" shows generated cabinets as assembled boxes. */
test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] } });
// T159: the real frame watch never downgrades the view on the CPU-rendered runner (fps.ts); the
// slow chain is driven by the __nittcam3dSlow hook where a test needs it.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __nittcam3dNoAuto: boolean }).__nittcam3dNoAuto = true;
  });
});

const c = tr.cutList.cabinet;
const pt = tr.layout.preview3d;

test('two generated cabinets stand assembled with the generator sizes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  // Dolap 1: defaults (600 × 720 × 560, one door); Dolap 2: 900 wide, two doors.
  await page.getByTestId('cabinet-open').click();
  await page.getByTestId('cabinet-add').click();
  await page.getByTestId('cabinet-open').click();
  const dialog = page.getByTestId('cabinet-dialog');
  await page.getByTestId('cabinet-width').fill('900');
  await dialog.getByRole('radio', { name: c.doorCount[2] }).click();
  await page.getByTestId('cabinet-add').click();
  await expect(dialog).toHaveCount(0);
  await nest(page);

  await page.getByTestId('view-3d').click();
  const host = page.getByTestId('preview3d');
  await expect(host).toHaveAttribute('data-ready', 'true', { timeout: 20_000 });
  const toggle = page.getByTestId('preview3d-assembly');
  await expect(toggle).toHaveText(pt.assembly);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  // width × height × depth (sides 560 + door 18); the 8 mm back is not in the 18 mm list.
  await expect(host).toHaveAttribute('data-assembly', 'Dolap 1:600x720x578;Dolap 2:900x720x578');
  await expect(host).toHaveAttribute('aria-label', fill(pt.assemblyLabel, { count: 2 }));
  await expect(page.getByTestId('preview3d-assembly-canvas')).toBeVisible();
  await expect(page.getByTestId('preview3d-presets')).toBeHidden();
  await page.waitForTimeout(500);
  await host.screenshot({ path: test.info().outputPath('assembly.png') });
  // Back to the sheet view.
  await toggle.click();
  await expect(host).not.toHaveAttribute('data-assembly', /.+/);
  await expect(page.getByTestId('preview3d-presets')).toBeVisible();
});

test('T285: hinge cups of a template show on both doors of the assembled cabinet', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await page.getByTestId('cabinet-open').click();
  const dialog = page.getByTestId('cabinet-dialog');
  await page.getByTestId('cabinet-width').fill('800');
  await dialog.getByRole('radio', { name: c.doorCount[2] }).click();
  await page.getByTestId('cabinet-add').click();
  await expect(dialog).toHaveCount(0);

  // The ready hinge template on the door row (one row, two doors).
  await page.getByTestId('parts-view-drawing').click();
  await expect(page.getByTestId('editor-canvas')).toHaveAttribute('data-view', /\d/);
  const door = page
    .getByTestId('editor-part-list')
    .getByRole('button')
    .filter({ hasText: c.roles.door })
    .first();
  await door.click();
  await page.getByTestId('template-add').click();
  await page
    .getByTestId('template-menu-item')
    .filter({ hasText: 'Menteşe çukuru Ø35 (2 menteşe)' })
    .click();
  await page.getByTestId('template-place').click();
  await expect(page.getByTestId('template-pending')).toBeHidden();
  await nest(page);

  await page.getByTestId('view-3d').click();
  const host = page.getByTestId('preview3d');
  await expect(host).toHaveAttribute('data-ready', 'true', { timeout: 20_000 });
  await page.getByTestId('preview3d-assembly').click();
  await expect(host).toHaveAttribute('data-assembly', 'Dolap 1:800x720x578');
  // Both doors are drawn with the part geometry (cups on the inside face), the rest as boards.
  await expect(host).toHaveAttribute('data-assembly-features', '2');
  await expect(page.getByTestId('preview3d-assembly-canvas')).toBeVisible();
  await page.waitForTimeout(500);
  await host.screenshot({ path: test.info().outputPath('assembly-hinges.png') });
});
