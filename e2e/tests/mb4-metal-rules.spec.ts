import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { expectNoA11yViolations } from './visual/helpers';
import { goStep, openNewProject, paste, pickOption } from './wizard-helpers';

/**
 * MB4 (T349): material rules at step 1 (aluminium on a machine without the metal declaration) and
 * the parts screen of a kind without edge band (ACM): no band columns, no "Dolap ekle", the info
 * notice; back on MDF the band values and the finished-size cut return exactly.
 */
const m = tr.materials;

test.describe('MB4 metal rules', () => {
  test('aluminium needs a metal machine; ACM hides band and cabinet, MDF gets them back', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'makine');
    const select = page.getByTestId('wizard-material');
    await pickOption(select, m.aluminium);
    await expect(page.getByTestId('material-rule-metal')).toBeVisible();
    await expect(page.getByTestId('material-rule-fix-metal')).toHaveAttribute('href', /alan=metal/);

    await pickOption(select, m.mdf);
    await expect(page.getByTestId('material-rules')).toHaveCount(0);
    await goStep(page, 'parcalar');
    await paste(page, 'Ad\tEn\tBoy\tAdet\tÜst\tAlt\tSol\tSağ\nKapak\t600\t400\t1\t1\t1\t2\t2', 1);
    await page.getByTestId('dimension-mode').click();
    await expect(page.getByTestId('cell-cut')).toHaveAttribute('data-w', '596');
    await expect(page.getByTestId('cabinet-open')).toHaveCount(1);
    await expect(page.getByTestId('edge-band-ignored')).toHaveCount(0);

    await goStep(page, 'makine');
    await pickOption(select, m.acm);
    await goStep(page, 'parcalar');
    await expect(page.getByTestId('edge-band-ignored')).toBeVisible();
    await expect(page.getByTestId('cabinet-open')).toHaveCount(0);
    await expect(page.getByTestId('dimension-mode')).toHaveCount(0);
    await expect(page.getByTestId('cell-cut')).toHaveCount(0);

    await goStep(page, 'makine');
    await pickOption(select, m.mdf);
    await goStep(page, 'parcalar');
    await expect(page.getByTestId('dimension-mode')).toBeChecked();
    await expect(page.getByTestId('cell-cut')).toHaveAttribute('data-w', '596');
    await expect(page.getByTestId('cell-cut')).toHaveAttribute('data-h', '398');
  });

  test('T350: library entry of aluminium keeps its alloy; ACM shows colour code and film arrow', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const f = tr.materialLibrary.form;
    await page.goto('/ayarlar/malzemeler');
    await page.getByTestId('material-add').click();
    const dialog = page.getByTestId('material-dialog');
    await dialog.getByTestId('material-name').fill('Alu 5754');
    await expect(dialog.getByTestId('material-props')).toHaveCount(0);
    await pickOption(dialog.getByTestId('material-kind'), m.acm);
    await expect(dialog.getByTestId('material-color-code')).toBeVisible();
    await expect(dialog.getByText(tr.direction.film.title).first()).toBeVisible();
    await pickOption(dialog.getByTestId('material-kind'), m.aluminium);
    await expect(dialog.getByTestId('material-color-code')).toHaveCount(0);
    await dialog.getByTestId('material-alloy').fill('5754');
    await pickOption(dialog.getByTestId('material-tone'), tr.materialLibrary.tones.aluminium);
    await dialog.getByLabel(f.thicknessLabel.replace('{n}', '1')).fill('3');
    await expectNoA11yViolations(page);
    await dialog.getByTestId('material-save').click();
    await expect(dialog).toHaveCount(0);
    const row = page.locator('[data-testid=material-row][data-name="Alu 5754"]');
    await row.getByTestId('material-edit').click();
    await expect(dialog.getByTestId('material-alloy')).toHaveValue('5754');
  });

  test('T351: example ACM 3 and 4 mm sets in one action; family cells only on metal rows', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const t = tr.machines;
    await page.goto('/makineler');
    await page.getByRole('button', { name: t.add }).click();
    await expect(page.getByRole('heading', { name: t.form.createTitle })).toBeVisible();
    const rows = await page.locator('[data-testid^="material-tabs-"]').count();
    // wood rows: no family detail
    await expect(page.locator('[data-testid^="material-family-"]')).toHaveCount(0);
    await page.getByTestId('materials-add-acm').click();
    await expect(page.locator('[data-testid^="material-tabs-"]')).toHaveCount(rows + 2);
    await expect(page.locator('[data-testid^="material-family-"]')).toHaveCount(2);
    await expect(page.getByTestId('materials-add-acm')).toHaveCount(0);
    await expect(page.getByTestId(`material-family-${rows}`)).toContainText(t.form.family.rampDeg);
    await expect(page.getByTestId('material-unverified-note').first()).toBeVisible();
    await expectNoA11yViolations(page);
  });
});
