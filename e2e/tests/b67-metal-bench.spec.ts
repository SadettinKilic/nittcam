import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { openNewProject, paste, saved, watchConsole } from './wizard-helpers';

// T390 (D-131): a part shown in aluminium with its real thickness on a wood project; undo; reload
// keeps it; the fastener switch says when there is no aligned hole pair.
test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] } });

const b = tr.bench;
const PARTS = ['Parça adı\tEn\tBoy\tAdet', 'Panel\t500\t400\t1', 'Braket\t80\t60\t1'].join('\n');

test('mixed materials: aluminium bracket 3 mm on a wood panel, undo, reload', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await paste(page, PARTS, 2);
  await page.getByTestId('parts-view-assembly').click();
  const bench = page.getByTestId('bench');
  await expect(bench).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await expect(page.getByTestId('bench-fasteners')).toBeChecked();
  await expect(page.getByText(b.tools.fastenersNone)).toBeVisible();

  const rows = page.getByTestId('bench-part');
  await rows.nth(1).getByRole('button', { pressed: false }).first().click();
  const inspector = page.getByTestId('bench-inspector');
  await expect(inspector).toContainText('80 × 60 × 18');
  await page.getByTestId('bench-material').click();
  await page.getByRole('option', { name: tr.materials.aluminium }).click();
  // Aluminium starts at its second common thickness (1,5 mm); type the real one.
  const thick = page.getByTestId('bench-thickness');
  await expect(thick).toBeVisible();
  // The select hands focus back to its trigger once closed; type after that.
  await expect(page.getByTestId('bench-material')).toBeFocused();
  await expect(thick).toHaveValue('1,5');
  await thick.fill('3');
  await thick.press('Enter');
  await expect(inspector).toContainText('80 × 60 × 3');
  await expect(inspector).toContainText(b.inspector.lookHint);

  await thick.blur(); // undo is not taken from inside a number field
  await page.keyboard.press('Control+z');
  await expect(inspector).toContainText('80 × 60 × 1,5');
  await page.keyboard.press('Control+y');
  await expect(inspector).toContainText('80 × 60 × 3');

  await saved(page);
  await page.reload();
  await expect(page.getByTestId('bench')).toHaveAttribute('data-ready', 'true', {
    timeout: 30_000,
  });
  await page
    .getByTestId('bench-part')
    .nth(1)
    .getByRole('button', { pressed: false })
    .first()
    .click();
  await expect(page.getByTestId('bench-material')).toContainText(tr.materials.aluminium);
  await expect(page.getByTestId('bench-inspector')).toContainText('80 × 60 × 3');

  // Back to the stock material: the thickness field goes, the stock thickness returns.
  await page.getByTestId('bench-material').click();
  await page.getByRole('option', { name: /^Proje malzemesi/ }).click();
  await expect(page.getByTestId('bench-thickness')).toHaveCount(0);
  await expect(page.getByTestId('bench-inspector')).toContainText('80 × 60 × 18');
  expect(errors).toEqual([]);
});
