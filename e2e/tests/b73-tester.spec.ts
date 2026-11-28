import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  goStep,
  openNewProject,
  pasteAndNest,
  pickOption,
  saved,
  watchConsole,
} from './wizard-helpers';

// Tester B73 (PR #246): the rider tray (front/back flanges recessed by the 4 mm thickness) closes
// on the bench at 90°; "Dik dalma" is locked with its reason in Simülasyon for ACM.
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
// Same outline and fold lines as the `acm-tray` golden fixture (T427 rider, D-145).
const outline = [
  [29, 0],
  [221, 0],
  [221, 25],
  [250, 25],
  [250, 225],
  [221, 225],
  [221, 250],
  [29, 250],
  [29, 225],
  [0, 225],
  [0, 25],
  [29, 25],
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
  g(90, outline.length),
  g(70, 1),
  ...outline.flatMap(([x, y]) => [g(10, x as number), g(20, y as number)]),
  ...line('V-kanal', 29, 25, 221, 25),
  ...line('V-kanal', 225, 25, 225, 225),
  ...line('V-kanal', 221, 225, 29, 225),
  ...line('V-kanal', 25, 225, 25, 25),
  g(0, 'ENDSEC'),
  g(0, 'EOF'),
].join('\n');

test('rider tray closes at 90° on the bench (no clash)', async ({ page }) => {
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
  await expect(dialog.getByTestId('dxf-layer-V-kanal')).toHaveAttribute('data-value', 'vgroove');
  await dialog.getByTestId('dxf-confirm').click();
  await expect(dialog).toBeHidden();

  await page.getByTestId('parts-view-assembly').click();
  const bench = page.getByTestId('bench');
  await expect(bench).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  const panel = page.getByTestId('bench-fold');
  await panel.getByTestId('bench-fold-all').getByRole('slider').focus();
  await page.keyboard.press('End');
  await expect(bench).toHaveAttribute('data-fold', '100');
  await expect(panel.getByTestId('bench-fold-part')).toHaveAttribute('data-state', 'closed');
  await expect(panel.getByTestId('bench-fold-state')).toHaveText(f.states.closed);
  await page.waitForTimeout(500);
  await page.screenshot({ path: '__screenshots__/b73-tray-closed-1440.png' });
  expect(errors).toEqual([]);
});

const SMALL = 'Ad\tEn\tBoy\tAdet\nTakoz\t80\t50\t2\nPanel\t400\t300\t1';

async function acmSimulation(page: Page, width: number) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'makine');
  await pickOption(page.getByTestId('wizard-material'), tr.materials.acm);
  await goStep(page, 'parcalar');
  await pasteAndNest(page, SMALL, 2);
  await saved(page);
  await goStep(page, 'simulasyon');
  // no ACM set on the default machine: the check is blocked, the settings panel still shows
  await page.setViewportSize({ width, height: 900 });
  await expect(page.getByTestId('sim-cutting-entry')).toBeVisible({ timeout: 30_000 });
}

for (const width of [1440, 1024]) {
  test(`ACM Simülasyon: "Dik dalma" locked with the reason at ${width}`, async ({ page }) => {
    test.setTimeout(180_000);
    const errors = watchConsole(page);
    await acmSimulation(page, width);
    const entry = page.getByTestId('sim-cutting-entry');
    const straight = entry.getByRole('radio', { name: tr.simulation.cutting.entry.straight });
    await straight.scrollIntoViewIfNeeded();
    await expect(straight).toBeDisabled();
    await expect(
      entry.getByRole('radio', { name: tr.simulation.cutting.entry.ramp }),
    ).toBeChecked();
    await expect(page.getByTestId('sim-cutting-entry-locked')).toHaveText(
      tr.simulation.cutting.entry.lockedStraight,
    );
    // clicking the label must not switch it
    await entry
      .getByText(tr.simulation.cutting.entry.straight, { exact: true })
      .click({ force: true });
    await expect(straight).not.toBeChecked();
    await page.getByTestId('sim-cutting-entry-locked').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `__screenshots__/b73-sim-locked-${width}.png` });
    expect(errors).toEqual([]);
  });
}
