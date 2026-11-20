import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { expectNoA11yViolations } from './visual/helpers';
import {
  fill,
  openGrainedProject,
  openNewProject,
  pickOption,
  watchConsole,
} from './wizard-helpers';

/** B8: material & stock library (T121) and the step 1 grain dial placement (T252). */

const m = tr.materialLibrary;
const w = tr.wizard.machine;

async function libraryOption(page: Page, name: RegExp) {
  const trigger = page.getByTestId('wizard-material');
  await trigger.click();
  const listbox = page.getByRole('listbox');
  await listbox.getByRole('option', { name }).click();
  await expect(listbox).toBeHidden();
}

const row = (page: Page, name: string) =>
  page.locator(`[data-testid=material-row][data-name="${name}"]`);

test.describe('T121 material library', () => {
  test('Ayarlar → Malzemeler: seeded list, create, edit and delete', async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto('/');
    await page
      .getByRole('navigation', { name: tr.nav.label })
      .getByRole('link', { name: tr.nav.settings })
      .click();
    // T182: Ayarlar opens on "Genel"; Malzemeler is one of its sections.
    await expect(page).toHaveURL(/\/ayarlar$/);
    await page
      .getByTestId('settings-nav')
      .getByRole('link', { name: tr.settings.nav.materials })
      .click();
    await expect(page).toHaveURL(/\/ayarlar\/malzemeler$/);
    await expect(page.getByRole('heading', { level: 1, name: m.title })).toBeVisible();
    for (const name of ['Akrilik', 'Kontrplak', 'MDF', 'Melamin']) {
      await expect(row(page, name)).toHaveCount(1);
    }
    // The example machine has MDF 18 cutting parameters: the link is shown per machine.
    await expect(row(page, 'MDF').getByTestId('material-params')).not.toBeEmpty();

    // Create (an empty name is refused first).
    await page.getByTestId('material-add').click();
    const dialog = page.getByTestId('material-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByTestId('material-name').fill('');
    await dialog.getByTestId('material-save').click();
    await expect(dialog.getByText(m.form.errors.name)).toBeVisible();
    await dialog.getByTestId('material-name').fill('Huş kontrplak');
    await pickOption(dialog.getByTestId('material-kind'), tr.materials.plywood);
    await dialog.getByRole('button', { name: m.form.addThickness }).click();
    await dialog.getByLabel(fill(m.form.thicknessLabel, { n: 2 })).fill('12');
    await dialog.getByLabel(fill(m.form.sheetWidth, { n: 1 })).fill('2500');
    await dialog.getByLabel(fill(m.form.sheetHeight, { n: 1 })).fill('1250');
    await dialog.getByTestId('material-grain-on').check();
    await dialog.getByTestId('material-grain').fill('90');
    await expectNoA11yViolations(page);
    await dialog.getByTestId('material-save').click();
    await expect(dialog).toHaveCount(0);
    const hus = row(page, 'Huş kontrplak');
    await expect(hus.getByTestId('material-thicknesses')).toHaveText('12 · 18 mm');
    await expect(hus).toContainText('90°');

    // Edit: rename, Enter saves.
    await hus.getByTestId('material-edit').click();
    await dialog.getByTestId('material-name').fill('Huş 18');
    await dialog.getByTestId('material-name').press('Enter');
    await expect(row(page, 'Huş 18')).toBeVisible();

    // Delete (with confirmation).
    await row(page, 'Huş 18').getByTestId('material-remove').click();
    await page.getByTestId('material-remove-confirm').click();
    await expect(row(page, 'Huş 18')).toHaveCount(0);
    await expect(page.getByTestId('material-row')).toHaveCount(4);
    expect(problems).toEqual([]);
  });

  test('wizard step 1 picks material → thickness → sheet from the library', async ({ page }) => {
    const problems = watchConsole(page);
    await openNewProject(page, 'makine');
    // T259: a new project starts on a library entry; start from the generic kind here.
    await pickOption(page.getByTestId('wizard-material'), tr.materials.mdf);
    await libraryOption(page, /^Kontrplak\s*18 mm$/);
    const material = page.getByTestId('wizard-material');
    await expect(material).toHaveAttribute('data-value', 'plywood');
    await expect(material).toHaveAttribute('data-library-id', /.+/);
    await expect(material).toHaveText(/Kontrplak/);
    // Thickness and sheet come from the entry; the entry's grain (0°) is set.
    await expect(page.getByText(fill(w.libraryThicknessHint, { list: '18' }))).toBeVisible();
    await expect(page.getByLabel(fill(w.preset, { a: '2.070', b: '2.800' }))).toBeChecked();
    await expect(page.getByLabel(fill(w.preset, { a: '1.220', b: '2.440' }))).toBeVisible();
    await expect(page.getByLabel(fill(w.preset, { a: '2.100', b: '2.800' }))).toHaveCount(0);
    await expect(page.getByTestId('sheet-preview-grain')).toHaveAttribute('data-angle', '0');
    // Custom size is still possible.
    await page.getByLabel(w.custom).check();
    const width = page.getByTestId('wizard-sheet-width');
    await width.fill('2600');
    await width.press('Enter');
    await expect(page.getByLabel(w.custom)).toBeChecked();
    // Undo: the custom width, then the whole library pick in one step.
    await page.getByTestId('wizard-undo').click();
    await page.getByTestId('wizard-undo').click();
    await expect(material).toHaveAttribute('data-value', 'mdf');
    await expect(material).not.toHaveAttribute('data-library-id', /.+/);
    expect(problems).toEqual([]);
  });
});

test.describe('T252 grain dial next to the sheet preview', () => {
  test('1440 × 900: preview and dial fully visible together; Sorun yok chip', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openGrainedProject(page);
    const preview = page.getByTestId('sheet-preview');
    const dial = page.getByTestId('sheet-grain-dial');
    await expect(dial).toBeVisible();
    // The dial lives inside the Önizleme card, under the sheet preview.
    await expect(preview.getByTestId('sheet-grain-dial')).toHaveCount(1);
    const footer = await page.getByTestId('wizard-footer').boundingBox();
    const svg = await preview.locator('svg[role=img]').boundingBox();
    const d = await dial.boundingBox();
    if (!footer || !svg || !d) throw new Error('no boxes');
    expect(svg.y).toBeGreaterThanOrEqual(0);
    expect(d.y).toBeGreaterThan(svg.y + svg.height - 1);
    expect(d.y + d.height).toBeLessThanOrEqual(footer.y + 1);
    // No issues on a fresh project: the chip in the card header, no Uyarılar card.
    await expect(page.getByTestId('machine-issue-chip')).toHaveText(tr.cutList.issueChip.ok);
    await expect(page.getByTestId('validation-panel')).toHaveCount(0);
    // With an issue the card returns (and the chip goes).
    await pickOption(page.getByTestId('wizard-material'), tr.materials.pvc);
    await expect(page.getByTestId('validation-panel')).toBeVisible();
    await expect(page.getByTestId('machine-issue-chip')).toHaveCount(0);
  });

  test('390 × 844: the preview card sits directly above the dial block', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openGrainedProject(page);
    const svg = await page.getByTestId('sheet-preview').locator('svg[role=img]').boundingBox();
    const d = await page.getByTestId('sheet-grain-dial').boundingBox();
    if (!svg || !d) throw new Error('no boxes');
    expect(d.y).toBeGreaterThan(svg.y + svg.height - 1);
    expect(d.y - (svg.y + svg.height)).toBeLessThan(120);
  });
});
