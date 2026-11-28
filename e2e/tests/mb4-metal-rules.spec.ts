import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
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
    await expect(page.getByTestId('material-rule-fix-metal')).toHaveAttribute(
      'href',
      /alan=metal/,
    );

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
});
