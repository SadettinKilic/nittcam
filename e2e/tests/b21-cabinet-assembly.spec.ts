import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { fill, nest, openNewProject } from './wizard-helpers';

/**
 * B21 T158: "Montaj görünümü" shows generated cabinets as assembled boxes; T285: a door row with
 * the ready hinge template shows its cups on both doors. One test on purpose: every nest + 3D
 * start is heavy on the CPU-rendered runner (SwiftShader), so the file runs one 3D scene only.
 */
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

test('two generated cabinets stand assembled; hinge cups show on both doors (T285)', async ({
  page,
}) => {
  // Nesting and the first SwiftShader frames take long on a busy CI runner (bounded work).
  test.setTimeout(90_000);
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

  // T285: the ready hinge template on Dolap 2's door row (one row, two doors).
  await page.getByTestId('parts-view-drawing').click();
  await expect(page.getByTestId('editor-canvas')).toHaveAttribute('data-view', /\d/);
  await page
    .getByTestId('editor-part-list')
    .getByRole('button')
    .filter({ hasText: c.roles.door })
    .last()
    .click();
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
  await expect(host).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  const toggle = page.getByTestId('preview3d-assembly');
  await expect(toggle).toHaveText(pt.assembly);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  // width × height × depth (sides 560 + door 18); the 8 mm back is not in the 18 mm list.
  await expect(host).toHaveAttribute('data-assembly', 'Dolap 1:600x720x578;Dolap 2:900x720x578');
  await expect(host).toHaveAttribute('aria-label', fill(pt.assemblyLabel, { count: 2 }));
  // T285: Dolap 2's two doors are drawn with the part geometry, every other board as a box.
  await expect(host).toHaveAttribute('data-assembly-features', '2');
  await expect(page.getByTestId('preview3d-assembly-canvas')).toBeVisible();
  await expect(page.getByTestId('preview3d-presets')).toBeHidden();
  await page.waitForTimeout(500);
  await host.screenshot({ path: test.info().outputPath('assembly.png') });
  // Back to the sheet view.
  await toggle.click();
  await expect(host).not.toHaveAttribute('data-assembly', /.+/);
  await expect(page.getByTestId('preview3d-presets')).toBeVisible();
});
