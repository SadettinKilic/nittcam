import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { goStep, openThinSkinProject, pasteAndNest, saved } from './wizard-helpers';

// T300 (CTO #12 E1, D-045, D-085): a sheet margin below the tool radius is caught on Dizilim; the
// Simülasyon envelope error names the margin and links back to the field, not to Makineler.
// D-129: with tabs the effective margin is Ø + 3; the stored margin counts with thin skin.

test('T300: a too-small margin warns on Dizilim and the Simülasyon finding points to it', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openThinSkinProject(page);
  await pasteAndNest(page, 'Ad\tEn\tBoy\tAdet\nYan\t560\t720\t1', 1);
  await saved(page);

  const margin = page.getByTestId('layout-margin');
  await expect(page.getByTestId('layout-margin-warning')).toHaveCount(0);
  await expect(page.getByTestId('layout-gap-note')).toBeVisible();
  await margin.fill('0');
  await margin.press('Enter');
  const warning = page.getByTestId('layout-margin-warning');
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('en az');
  await expect(margin).toHaveAttribute('aria-describedby', /note/);
  // The step indicator keeps a mark on Dizilim.
  await expect(page.getByText(tr.wizard.steps.errors.marginLow).first()).toBeAttached();

  await page.getByRole('button', { name: tr.layout.renest, exact: true }).first().click();
  await saved(page);
  await goStep(page, 'simulasyon');
  const hint = page.getByTestId('sim-margin-hint');
  await expect(hint).toBeVisible({ timeout: 30_000 });
  await expect(hint).toContainText('kenar payı');
  await page.getByTestId('violation-open-margin').click();
  await expect(page.getByTestId('layout-margin')).toBeFocused({ timeout: 10_000 });

  await page.getByTestId('layout-margin').fill('10');
  await page.getByTestId('layout-margin').press('Enter');
  await expect(page.getByTestId('layout-margin-warning')).toHaveCount(0);
});
