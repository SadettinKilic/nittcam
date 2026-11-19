import AxeBuilder from '@axe-core/playwright';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { openNewProject } from './wizard-helpers';

// B16 tester 2 (T146): refusal texts (binary, oversize, empty, parse), keyboard path, drill layer
// → holes through the dialog, drawing-board entry, axe at 1440 / 1024 (light + dark), 390 smoke.
// Screenshots go to e2e/__screenshots__/ (git-ignored review captures).

const t = tr.dxfImport;
const fixture = (name: string) =>
  fileURLToPath(new URL(`../../packages/core/src/dxf/__fixtures__/${name}`, import.meta.url));

async function axeClean(page: Page) {
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual(
    [],
  );
}

async function openDialog(page: Page, width = 1440) {
  await page.setViewportSize({ width, height: 900 });
  await openNewProject(page, 'parcalar');
  await page.getByTestId('dxf-open').click();
  const dialog = page.getByTestId('dxf-dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

const dxfText = (entities: string) =>
  `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n4\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`;
const rect = (l: string, x0: number, y0: number, x1: number, y1: number) =>
  `0\nLWPOLYLINE\n8\n${l}\n90\n4\n70\n1\n10\n${x0}\n20\n${y0}\n10\n${x1}\n20\n${y0}\n10\n${x1}\n20\n${y1}\n10\n${x0}\n20\n${y1}\n`;
const circle = (l: string, x: number, y: number, r: number) =>
  `0\nCIRCLE\n8\n${l}\n10\n${x}\n20\n${y}\n30\n0\n40\n${r}\n`;

test.describe('B16 tester: DXF dialog refusals', () => {
  test('binary, oversize, empty and garbage files are refused with their own text', async ({
    page,
  }) => {
    const dialog = await openDialog(page);
    const file = dialog.getByTestId('dxf-file');
    const problem = dialog.getByTestId('dxf-problem');
    const confirm = dialog.getByTestId('dxf-confirm');

    await file.setInputFiles({
      name: 'logo.dxf',
      mimeType: 'application/dxf',
      buffer: Buffer.concat([Buffer.from('AutoCAD Binary DXF\r\n\u001a\u0000'), Buffer.alloc(64)]),
    });
    await expect(problem).toHaveText(t.problems.binary);
    await expect(confirm).toBeDisabled();

    await file.setInputFiles({
      name: 'big.dxf',
      mimeType: 'application/dxf',
      buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 0x20),
    });
    await expect(problem).toHaveText(t.problems.size);
    await expect(confirm).toBeDisabled();

    await file.setInputFiles({
      name: 'text-only.dxf',
      mimeType: 'application/dxf',
      buffer: Buffer.from(dxfText('0\nTEXT\n8\nA\n10\n0\n20\n0\n40\n5\n1\nMerhaba\n')),
    });
    await expect(problem).toHaveText(t.problems.empty);
    await expect(confirm).toBeDisabled();

    await file.setInputFiles({
      name: 'junk.dxf',
      mimeType: 'application/dxf',
      buffer: Buffer.from('hello world, not a dxf'),
    });
    await expect(problem).toHaveText(t.problems.parse);
    await expect(confirm).toBeDisabled();

    // A good file after a refusal clears the problem.
    await file.setInputFiles(fixture('rect-lines-gaps.dxf'));
    await expect(problem).toHaveCount(0);
    await expect(dialog.getByTestId('dxf-preview')).toBeVisible();
  });
});

test.describe('B16 tester: DXF dialog flow', () => {
  test('keyboard: open with Enter, Escape closes without changing the cut list', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'parcalar');
    await page.getByTestId('dxf-open').focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByTestId('dxf-dialog');
    await expect(dialog).toBeVisible();
    // Note (not blocking): initial focus lands on the visually hidden file input.
    await expect(dialog.getByTestId('dxf-file')).toBeFocused();
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    // Note (not blocking): focus goes to <body>, not back to the "DXF içe aktar" button.
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      tr.cutList.count.replace('{rows}', '0').replace('{pieces}', '0'),
    );
  });

  test('drill layer: circles become holes; island part counted', async ({ page }) => {
    await page.route('**/api/settings/dxf-layers', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ json: { map: {} } })
        : route.fulfill({ json: { map: {} } }),
    );
    const dialog = await openDialog(page);
    await dialog.getByTestId('dxf-file').setInputFiles({
      name: 'plate.dxf',
      mimeType: 'application/dxf',
      buffer: Buffer.from(
        dxfText(
          rect('KESIM', 0, 0, 600, 600) +
            rect('KESIM', 100, 100, 500, 500) +
            rect('KESIM', 200, 200, 400, 400) +
            circle('DELIK', 50, 50, 4) +
            circle('DELIK', 550, 550, 4),
        ),
      ),
    });
    await expect(dialog.getByTestId('dxf-preview')).toHaveAttribute('data-parts', '2');
    await expect(dialog.getByTestId('dxf-layer-DELIK')).toBeVisible();
    await page.screenshot({ path: '__screenshots__/b16t-plate-auto-1440.png' });
    const { pickOption } = await import('./wizard-helpers');
    await pickOption(dialog.getByTestId('dxf-layer-DELIK'), t.layers.ops.drill);
    await expect(dialog.getByTestId('dxf-preview')).toHaveAttribute('data-parts', '2');
    await page.screenshot({ path: '__screenshots__/b16t-plate-drill-1440.png' });
    await dialog.getByTestId('dxf-confirm').click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      tr.cutList.count.replace('{rows}', '2').replace('{pieces}', '2'),
    );
  });

  test('drawing board entry opens the same dialog', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'parcalar');
    await page.getByTestId('parts-view-drawing').click();
    await expect(page.getByTestId('editor-canvas')).toHaveAttribute('data-view', /\d/);
    const entry = page.getByTestId('board-dxf-open');
    await expect(entry).toBeVisible();
    await entry.click();
    const dialog = page.getByTestId('dxf-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('dxf-file').setInputFiles(fixture('sign-letters-400.dxf'));
    await expect(dialog.getByTestId('dxf-preview')).toHaveAttribute('data-parts', '3');
    await dialog.getByTestId('dxf-confirm').click();
    await expect(dialog).toBeHidden();
    await page.screenshot({ path: '__screenshots__/b16t-board-after-1440.png' });
    await expect(page.getByTestId('editor-part-list').locator('li')).toHaveCount(3);
    // one undo removes all three letters
    await page.getByTestId('wizard-undo').click();
    await expect(page.getByTestId('editor-part-list').locator('li')).toHaveCount(0);
  });
});

for (const width of [1440, 1024, 390]) {
  for (const scheme of ['light', 'dark'] as const) {
    if (width === 390 && scheme === 'dark') continue;
    test(`dialog with report + unit question: axe, no horizontal scroll ${width} ${scheme}`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.route('**/api/settings/dxf-layers', (route) =>
        route.fulfill({ json: { map: {} } }),
      );
      const dialog = await openDialog(page, width);
      await dialog.getByTestId('dxf-file').setInputFiles(fixture('no-units-small.dxf'));
      await expect(dialog.getByText(t.unit.question)).toBeVisible();
      await axeClean(page);
      await page.screenshot({ path: `__screenshots__/b16t-unit-${width}-${scheme}.png` });
      await dialog.getByTestId('dxf-file').setInputFiles(fixture('rect-lines-gaps.dxf'));
      await expect(dialog.getByTestId('dxf-preview')).toBeVisible();
      await axeClean(page);
      await page.screenshot({ path: `__screenshots__/b16t-report-${width}-${scheme}.png` });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      await expect(dialog.getByTestId('dxf-confirm')).toBeVisible();
    });
  }
}
