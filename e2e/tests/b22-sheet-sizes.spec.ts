import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { expectNoA11yViolations } from './visual/helpers';
import { fill, goStep, KITCHEN, openNewProject, paste, watchConsole } from './wizard-helpers';

/** B22 / T164: stock quantity per library sheet size and several sheet sizes in one nesting. */

const m = tr.materialLibrary;
const w = tr.wizard.machine;

const row = (page: Page, name: string) =>
  page.locator(`[data-testid=material-row][data-name="${name}"]`);

async function openMaterials(page: Page) {
  await page.goto('/');
  await page
    .getByRole('navigation', { name: tr.nav.label })
    .getByRole('link', { name: tr.nav.settings })
    .click();
  await expect(page).toHaveURL(/\/ayarlar\/malzemeler$/);
}

/** Sets (or clears with '') the stock quantity of Kontrplak's second sheet size. */
async function setKontrplakQty(page: Page, qty: string) {
  await row(page, 'Kontrplak').getByTestId('material-edit').click();
  const dialog = page.getByTestId('material-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(fill(m.form.sheetQty, { n: 2 })).fill(qty);
  await dialog.getByTestId('material-save').click();
  await expect(dialog).toHaveCount(0);
}

test.describe('T164 several stock sheet sizes', () => {
  test('Malzemeler: a stock quantity per sheet size is saved and listed', async ({ page }) => {
    const problems = watchConsole(page);
    await openMaterials(page);
    await setKontrplakQty(page, '2');
    await expect(row(page, 'Kontrplak')).toContainText(fill(m.sheetQty, { n: 2 }));
    // Empty = no limit again (keeps the seeded library as the other specs expect it).
    await setKontrplakQty(page, '');
    await expect(row(page, 'Kontrplak')).not.toContainText(fill(m.sheetQty, { n: 2 }));
    expect(problems).toEqual([]);
  });

  test('wizard: a second library size is used by the nesting, reported per size', async ({
    page,
  }) => {
    const problems = watchConsole(page);
    await openNewProject(page, 'makine');
    const trigger = page.getByTestId('wizard-material');
    await trigger.click();
    await page
      .getByRole('listbox')
      .getByRole('option', { name: /^Kontrplak\s*18 mm$/ })
      .click();
    const sizes = page.getByTestId('wizard-sheet-sizes');
    await expect(sizes).toBeVisible();
    const chosen = sizes.getByLabel(fill(w.sheetsOption, { w: '2.800', h: '2.070' }));
    const second = sizes.getByLabel(fill(w.sheetsOption, { w: '2.440', h: '1.220' }));
    await expect(chosen).toBeChecked();
    await expect(chosen).toBeDisabled();
    await expect(second).not.toBeChecked();
    await second.click();
    await expect(second).toBeChecked();
    await expectNoA11yViolations(page);
    // One undo step per tick.
    await page.getByTestId('wizard-undo').click();
    await expect(second).not.toBeChecked();
    await page.getByTestId('wizard-redo').click();
    await expect(second).toBeChecked();

    await goStep(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    await goStep(page, 'dizilim');
    await expect(page.getByTestId('nesting-sheets')).toBeVisible({ timeout: 20_000 });
    const bySize = page.getByTestId('nesting-by-size');
    await expect(bySize).toBeVisible();
    await expect(bySize.getByRole('listitem')).toHaveCount(2);
    await expect(bySize).toContainText('2.440 × 1.220 mm');
    expect(problems).toEqual([]);
  });
});
