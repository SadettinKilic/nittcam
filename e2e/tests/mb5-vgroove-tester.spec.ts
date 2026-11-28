import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { goStep, openNewProject, pickOption } from './wizard-helpers';

// MB5 tester: ACM tray DXF (outline + 4 fold lines on layer "V-kanal") -> V-groove inspector,
// remaining skin edit, Simulasyon; wood has no V-groove option.
const m = tr.materials;
const kinds = tr.editor.inspector.operation.kinds;
const g = (c: number, v: string | number) => `${String(c).padStart(3)}\n${v}`;
const line = (layer: string, x1: number, y1: number, x2: number, y2: number) =>
  [0, 'LINE', 8, layer, 10, x1, 20, y1, 11, x2, 21, y2].reduce<string[]>(
    (a, v, i, arr) =>
      i % 2 === 0 ? [...a, g(arr[i] as number, arr[i + 1] as string | number)] : a,
    [],
  );
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
  g(10, 0),
  g(20, 0),
  g(10, 200),
  g(20, 0),
  g(10, 200),
  g(20, 200),
  g(10, 0),
  g(20, 200),
  ...line('V-kanal', 25, 0, 25, 200),
  ...line('V-kanal', 175, 0, 175, 200),
  ...line('V-kanal', 0, 25, 200, 25),
  ...line('V-kanal', 0, 175, 200, 175),
  g(0, 'ENDSEC'),
  g(0, 'EOF'),
].join('\n');

async function axe(page: Page) {
  await page.waitForTimeout(500);
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
}

test('ACM tray from DXF: V-kanal inspector, remaining skin, groove band, Simulasyon', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'makine');
  await pickOption(page.getByTestId('wizard-material'), m.acm);
  await goStep(page, 'parcalar');
  await page.getByTestId('dxf-open').click();
  const dialog = page.getByTestId('dxf-dialog');
  await dialog
    .getByTestId('dxf-file')
    .setInputFiles({ name: 'tepsi.dxf', mimeType: 'application/dxf', buffer: Buffer.from(dxf) });
  await expect(dialog.getByTestId('dxf-layer-V-kanal')).toBeVisible();
  await pickOption(dialog.getByTestId('dxf-layer-V-kanal'), tr.dxfImport.layers.ops.vgroove);
  await page.screenshot({ path: 'e2e/__screenshots__/mb5-dxf-dialog.png' });
  await dialog.getByTestId('dxf-confirm').click();
  await expect(dialog).toBeHidden();
  await page.getByTestId('parts-view-drawing').click();
  await page.getByTestId('editor-part-list').getByRole('button').first().click();
  for (let i = 0; i < 4; i++) {
    await expect(page.getByTestId(`prop-op-line-${i}`)).toHaveAttribute('data-value', 'vgroove');
  }
  await expect(page.getByTestId('prop-op-line-0')).toContainText(kinds.vgroove);
  const rem = page.getByTestId('prop-op-line-0-remaining');
  await expect(rem).toBeVisible();
  await page.screenshot({ path: 'e2e/__screenshots__/mb5-inspector-1440.png' });
  await rem.click();
  await rem.fill('1.1');
  await rem.press('Enter');
  await expect(rem).toHaveValue(/1[.,]1/);
  await rem.fill('0.3');
  await rem.press('Enter');
  await expect(page.getByText(/Kalan kalınlık .* arasında/).first()).toBeVisible();
  await rem.press('Escape');
  expect(await axe(page)).toEqual([]);
  await goStep(page, 'simulasyon');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'e2e/__screenshots__/mb5-sim-1440.png' });
});

test('wood part: no V-kanal option', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'makine');
  await pickOption(page.getByTestId('wizard-material'), m.mdf);
  await goStep(page, 'parcalar');
  await page.getByTestId('dxf-open').click();
  const dialog = page.getByTestId('dxf-dialog');
  await dialog
    .getByTestId('dxf-file')
    .setInputFiles({ name: 'tepsi.dxf', mimeType: 'application/dxf', buffer: Buffer.from(dxf) });
  await dialog.getByTestId('dxf-layer-V-kanal').click();
  await expect(page.getByRole('option', { name: tr.dxfImport.layers.ops.vgroove })).toHaveCount(0);
});

test('390 smoke on ACM tray', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openNewProject(page, 'makine');
  await pickOption(page.getByTestId('wizard-material'), m.acm);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect(await axe(page)).toEqual([]);
});
