import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { openNewProject, optionLabels, pickOption } from './wizard-helpers';

/**
 * MB3 (T346, D-130): ACM and aluminium are visible without a flag, under "Metal ve kompozit";
 * steel is a disabled row. Thickness chips and sheet presets come from the behaviour table.
 */
const m = tr.materials;
const w = tr.wizard.machine;

test.describe('MB3 metal kinds', () => {
  test('picker group, ACM presets, aluminium NC block reason', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'makine');
    const select = page.getByTestId('wizard-material');
    const labels = await optionLabels(select);
    expect(labels).toEqual(expect.arrayContaining([m.acm, m.aluminium, m.steel]));
    await pickOption(select, m.acm);
    await page.getByRole('button', { name: '4', exact: true }).click();
    await expect(
      page.getByLabel(w.preset.replace('{a}', '1.500').replace('{b}', '3.200')),
    ).toHaveCount(1);
    // Aluminium is pickable (its NC block is a validation error, unit-tested in core).
    await pickOption(select, m.aluminium);
    await expect(select).toContainText(m.aluminium);
  });
});
