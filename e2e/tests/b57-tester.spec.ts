import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  goStep,
  nest,
  openGrainedProject,
  openNewProject,
  paste,
  pickOption,
  saved,
} from './wizard-helpers';

/**
 * B57 tester: T318 usta 1 list on a grained sheet (Baza 2400 × 100 "Var" fits, bulk edit "Boy
 * boyunca" and "Değiştirme"), T317 inspector "Sol / sağ kapak" block (1440 light/dark, 390 smoke,
 * axe).
 */

async function axeClean(page: Page) {
  const res = await new AxeBuilder({ page }).analyze();
  const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
}

async function noPageScroll(page: Page) {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(over).toBeLessThanOrEqual(1);
}

const USTA = [
  'Parça Adı\tBoy\tEn\tAdet\tDamar',
  'Üst kapak\t716\t297\t4\tVar',
  'Baza\t2400\t100\t2\tVar',
  'Yan\t720\t560\t2\tVar',
  'Raf\t564\t300\t2\tYok',
].join('\n');

test('T318: usta list on a grained sheet nests every part; bulk edit keeps / sets Boy', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openGrainedProject(page, 'parcalar');
  await paste(page, USTA, 4);
  await saved(page);
  for (const n of [1, 2, 3]) {
    await expect(page.getByTestId(`grain-cell-${n}`)).toHaveAttribute('data-angle', '90');
  }
  // Bulk edit: "Değiştirme" keeps each row's grain; "Boy boyunca" sets the free row to 90°.
  await page.getByTestId('row-select-all').click();
  await page.getByTestId('bulk-open').click();
  const sheet = page.getByTestId('bulk-edit');
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(300);
  await axeClean(page);
  await page.screenshot({ path: `__screenshots__/b57-bulk-1440.png` });
  await pickOption(sheet.getByTestId('bulk-grain'), tr.cutList.bulk.grainKeep);
  // Nothing else set: the sheet asks for a field instead of applying a no-op.
  await sheet.getByTestId('bulk-apply').click();
  await expect(sheet.getByRole('alert')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(page.getByTestId('grain-cell-4')).toHaveAttribute('data-mode', 'free');
  await expect(page.getByTestId('grain-cell-2')).toHaveAttribute('data-angle', '90');

  await page.getByTestId('row-select-all').click(); // clears the selection
  await page.getByTestId('row-select-4').click();
  await page.getByTestId('bulk-open').click();
  await pickOption(
    page.getByTestId('bulk-edit').getByTestId('bulk-grain'),
    tr.cutList.bulk.grainAlongH,
  );
  await page.getByTestId('bulk-edit').getByTestId('bulk-apply').click();
  await expect(page.getByTestId('grain-cell-4')).toHaveAttribute('data-angle', '90');
  await expect(page.getByTestId('grain-cell-4')).toHaveAttribute('data-mode', 'fixed');
  await saved(page);

  // Usta 1: Baza 2400 × 100 "Var" said "plakaya sığmıyor"; now every part is on a sheet.
  await goStep(page, 'dizilim');
  await nest(page);
  await expect(page.getByTestId('layout-unplaced-chip')).toHaveCount(0);
  await page.screenshot({ path: `__screenshots__/b57-t318-dizilim-1440.png` });
});

for (const scheme of ['light', 'dark'] as const) {
  test(`T317: Sol / sağ kapak block, 1440 ${scheme} + 390 smoke, axe`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'parcalar');
    await paste(page, ['Parça adı\tEn\tBoy\tAdet', 'Kapak\t400\t700\t2'].join('\n'), 1);
    await saved(page);
    await page.getByTestId('parts-view-drawing').click();
    await expect(page.getByTestId('editor-canvas')).toHaveAttribute('data-view', /\d/);
    await page.getByTestId('editor-part-list').getByRole('button').first().click();
    const block = page.getByTestId('editor-mirror-pair');
    await expect(block).toBeVisible();
    await block.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await axeClean(page);
    await page.screenshot({ path: `__screenshots__/b57-t317-pair-1440-${scheme}.png` });
    // Keyboard: the button is reachable and works with Enter.
    await page.getByTestId('editor-mirror-pair-make').focus();
    await page.keyboard.press('Enter');
    await saved(page);
    await expect(page.getByTestId('editor-part-list').getByRole('button')).toHaveCount(2);
    if (scheme === 'light') {
      await page.setViewportSize({ width: 390, height: 844 });
      await noPageScroll(page);
      await axeClean(page);
      await page.screenshot({ path: `__screenshots__/b57-t317-390.png` });
    }
  });
}
