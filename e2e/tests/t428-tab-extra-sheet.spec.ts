import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { openNewProject, pasteAndNest } from './wizard-helpers';

// T428 (CTO #15 S6): seven 390 × 2000 strips on the 2800 × 2070 sheet. With tabs (D-129) the
// clearance grows and the seventh strip lands alone on a second sheet; with thin skin all seven fit
// on one. Step 3 says so and one click switches to thin skin and nests again.
const STRIPS = ['Parça adı\tEn\tBoy\tAdet\tDamar', 'Şerit\t390\t2000\t7\thayır'].join('\n');

test('tabs cost a sheet: the hint offers thin skin, one click nests on fewer sheets', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page, STRIPS, 1);
  const sheets = page.getByTestId('nesting-sheets');
  await expect(sheets).toHaveText('2', { timeout: 20_000 });

  const hint = page.getByTestId('layout-tab-extra-sheet');
  await expect(hint).toBeVisible({ timeout: 30_000 });
  await expect(hint).toHaveAttribute('data-sheets', '1');
  await expect(hint).toContainText(tr.wizard.layout.tabExtraSheet.split('{')[0] as string);

  await hint.getByTestId('layout-tab-extra-sheet-apply').click();
  await expect(sheets).toHaveText('1', { timeout: 20_000 });
  await expect(hint).toHaveCount(0);
});
