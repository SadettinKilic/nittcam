import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { fill, goStep, openNewProject, pasteAndNest, pickOption } from './wizard-helpers';

/** B5 round 2 tester: a locked copy the grain no longer allows shows the Turkish error on Dizilim. */

const l = tr.layout;
const SHELF = ['Parça adı\tEn\tBoy\tAdet\tDamar', 'Yan dikme\t300\t1800\t2\tevet'].join('\n');
const LABEL = '1.1 · Yan dikme';

test('lock, turn the sheet grain, Dizilim shows LOCKED_PLACEMENT_GRAIN; unlock clears it', async ({
  page,
}) => {
  await openNewProject(page, 'makine');
  const g0 = page.getByRole('radio', { name: tr.wizard.machine.grain0 });
  await g0.check();
  await pasteAndNest(page, SHELF, 1, 'makine');
  await expect(page.getByTestId('layout-canvas')).toHaveAttribute('data-part-count', '2');

  await pickOption(page.getByTestId('layout-select'), LABEL);
  await page.getByRole('button', { name: l.info.lock }).click();
  await expect(page.getByTestId('layout-info-locked')).toHaveText(l.info.lockedYes);

  const msg = fill(l.lockedGrainIssue, { label: LABEL });
  await expect(page.getByRole('alert').filter({ hasText: 'damar yönüne uymuyor' })).toHaveCount(0);

  await goStep(page, 'makine');
  await page.getByRole('radio', { name: tr.wizard.machine.grain90 }).check();
  await goStep(page, 'dizilim');
  const alert = page.getByRole('alert').filter({ hasText: 'damar yönüne uymuyor' });
  await expect(alert).toHaveCount(1);
  await expect(alert).toHaveText(msg);

  // Re-nest keeps the lock and the error.
  await page.getByRole('button', { name: l.renest }).click();
  await expect(page.getByRole('button', { name: l.renest })).toBeEnabled();
  await expect(alert).toHaveCount(1);

  // Unlock clears it.
  await pickOption(page.getByTestId('layout-select'), LABEL);
  await page.getByRole('button', { name: l.info.unlock }).click();
  await expect(alert).toHaveCount(0);
});
