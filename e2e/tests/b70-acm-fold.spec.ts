import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { goStep, openNewProject, pickOption, watchConsole } from './wizard-helpers';

// T391 (D-131): an ACM tray from DXF (outline + 4 fold lines on layer "V-kanal", no corner
// relief) folds on the montaj tezgâhı; the fold check says the corners need a relief.
test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] } });

const f = tr.bench.fold;
const g = (c: number, v: string | number) => `${String(c).padStart(3)}\n${v}`;
const line = (layer: string, x1: number, y1: number, x2: number, y2: number) => [
  g(0, 'LINE'),
  g(8, layer),
  g(10, x1),
  g(20, y1),
  g(11, x2),
  g(21, y2),
];
const dxf = [
  g(0, 'SECTION'),
  g(2, 'HEADER'),
  g(9, '$INSUNITS'),
  g(70, 4),
  g(0, 'ENDSEC'),
  g(0, 'SECTION'),
  g(2, 'ENTITIES'),
  g(0, 'LWPOLYLINE'),
  g(8, 'PART'),
  g(90, 4),
  g(70, 1),
  ...[0, 0, 200, 0, 200, 200, 0, 200].map((v, i) => g(i % 2 === 0 ? 10 : 20, v)),
  ...line('V-kanal', 25, 0, 25, 200),
  ...line('V-kanal', 175, 0, 175, 200),
  ...line('V-kanal', 0, 25, 200, 25),
  ...line('V-kanal', 0, 175, 200, 175),
  g(0, 'ENDSEC'),
  g(0, 'EOF'),
].join('\n');

test('ACM tray folds on the bench; no corner relief is red', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'makine');
  await pickOption(page.getByTestId('wizard-material'), tr.materials.acm);
  await goStep(page, 'parcalar');
  await page.getByTestId('dxf-open').click();
  const dialog = page.getByTestId('dxf-dialog');
  await dialog
    .getByTestId('dxf-file')
    .setInputFiles({ name: 'tepsi.dxf', mimeType: 'application/dxf', buffer: Buffer.from(dxf) });
  // B70 rider: the layer name alone makes it V-kanal on ACM (or the company mapping already does).
  await expect(dialog.getByTestId('dxf-layer-V-kanal')).toHaveAttribute('data-value', 'vgroove');
  await dialog.getByTestId('dxf-confirm').click();
  await expect(dialog).toBeHidden();

  await page.getByTestId('parts-view-assembly').click();
  const bench = page.getByTestId('bench');
  await expect(bench).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await expect(bench).toHaveAttribute('data-fold', '0');
  const panel = page.getByTestId('bench-fold');
  await expect(panel).toBeVisible();
  for (let i = 1; i <= 4; i++)
    await expect(panel.getByTestId(`bench-fold-groove-${i}`)).toBeVisible();
  // T427 (CTO #15 S5): the verdict is at the designed angles, so already flat it says clash.
  await expect(panel.getByTestId('bench-fold-part')).toHaveAttribute('data-state', 'clash');
  await expect(panel.getByTestId('bench-fold-state')).toHaveText(f.states.clash);

  await panel.getByTestId('bench-fold-all').getByRole('slider').focus();
  await page.keyboard.press('End');
  await expect(bench).toHaveAttribute('data-fold', '100');
  await expect(panel.getByTestId('bench-fold-part')).toHaveAttribute('data-state', 'clash');
  await expect(panel.getByTestId('bench-fold-state')).toHaveText(f.states.clash);
  await expect(panel.getByTestId('bench-fold-issues')).toContainText('köşe boşaltması');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'e2e/__screenshots__/b70-fold-1440.png' });

  // Back to flat: the per-groove slider follows the global one again.
  await page.keyboard.press('Home');
  await expect(bench).toHaveAttribute('data-fold', '0');
  expect(errors).toEqual([]);
});

// B70 tester repro: four V-kanal lines meeting at the relief corners chain into one closed
// contour on import; it still folds as four hinges (plain 25 × 25 corners overlap: red).
const crossDxf = [
  g(0, 'SECTION'),
  g(2, 'HEADER'),
  g(9, '$INSUNITS'),
  g(70, 4),
  g(0, 'ENDSEC'),
  g(0, 'SECTION'),
  g(2, 'ENTITIES'),
  g(0, 'LWPOLYLINE'),
  g(8, 'PART'),
  g(90, 12),
  g(70, 1),
  ...[
    25, 0, 175, 0, 175, 25, 200, 25, 200, 175, 175, 175, 175, 200, 25, 200, 25, 175, 0, 175, 0, 25,
    25, 25,
  ].map((v, i) => g(i % 2 === 0 ? 10 : 20, v)),
  ...line('V-kanal', 25, 25, 25, 175),
  ...line('V-kanal', 25, 175, 175, 175),
  ...line('V-kanal', 175, 175, 175, 25),
  ...line('V-kanal', 175, 25, 25, 25),
  g(0, 'ENDSEC'),
  g(0, 'EOF'),
].join('\n');

test('fold lines chained at the relief corners fold as four hinges', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'makine');
  await pickOption(page.getByTestId('wizard-material'), tr.materials.acm);
  await goStep(page, 'parcalar');
  await page.getByTestId('dxf-open').click();
  const dialog = page.getByTestId('dxf-dialog');
  await dialog.getByTestId('dxf-file').setInputFiles({
    name: 'tepsi-kose.dxf',
    mimeType: 'application/dxf',
    buffer: Buffer.from(crossDxf),
  });
  await expect(dialog.getByTestId('dxf-layer-V-kanal')).toHaveAttribute('data-value', 'vgroove');
  await dialog.getByTestId('dxf-confirm').click();
  await expect(dialog).toBeHidden();

  await page.getByTestId('parts-view-assembly').click();
  const bench = page.getByTestId('bench');
  await expect(bench).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  const panel = page.getByTestId('bench-fold');
  await expect(panel).toBeVisible();
  for (let i = 1; i <= 4; i++)
    await expect(panel.getByTestId(`bench-fold-groove-${i}`)).toBeVisible();
  await expect(panel.getByTestId('bench-fold-skipped')).toHaveCount(0);
  await panel.getByTestId('bench-fold-all').getByRole('slider').focus();
  await page.keyboard.press('End');
  await expect(bench).toHaveAttribute('data-fold', '100');
  await expect(panel.getByTestId('bench-fold-groove-1')).toContainText('90°');
  await expect(panel.getByTestId('bench-fold-part')).toHaveAttribute('data-state', 'clash');
  await expect(panel.getByTestId('bench-fold-issues')).toContainText('çakışıyor');
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'e2e/__screenshots__/b70-fold-chained-1440.png' });
  expect(errors).toEqual([]);
});
