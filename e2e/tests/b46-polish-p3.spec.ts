import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { fill, openNewProject, paste, projectId } from './wizard-helpers';

// B46 (polish P3, CTO #12): out-of-range defaults say the range; the cabinet split-off also works
// on a new project that was never saved.

const d = tr.settings.general.defaults;

test('P3: an out-of-range default says the range instead of a silent Kaydet', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/ayarlar');
  const gap = page.getByTestId('settings-default-gap');
  await gap.fill('150');
  await expect(page.getByText(fill(d.range, { max: '100' }))).toBeVisible();
  await expect(gap).toHaveAttribute('aria-invalid', 'true');
  await gap.fill('4');
  await expect(page.getByText(fill(d.range, { max: '100' }))).toHaveCount(0);
  // One vocabulary (Köprü / Kapalı / Climb) with Simülasyon.
  await expect(page.getByText(d.tabs, { exact: true })).toBeVisible();
});

test('P3: the cabinet split-off saves a new project first', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await paste(page, ['Parça adı\tEn\tBoy\tAdet', 'Raf\t500\t300\t2'].join('\n'), 1);
  // No wait for the first save: the split box is there at once.
  await page.getByTestId('cabinet-open').click();
  await page.getByTestId('cabinet-split').click();
  await expect(page.getByTestId('cabinet-split-thickness')).toHaveValue('8');
  await page.getByTestId('cabinet-add').click();
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: tr.cutList.cabinet.split.open }),
  ).toBeVisible({ timeout: 20_000 });
  await projectId(page);
  await expect(page.getByTestId('project-links-derived')).toBeVisible();
});

test('P3: the paste preview names the skipped rows', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await page.getByRole('button', { name: tr.cutList.pasteOpen }).click();
  await page
    .getByLabel(tr.cutList.paste.textLabel)
    .fill(['Ad\tEn\tBoy\tAdet', 'Yan\t560\t720\t2', 'Bozuk\t0\t300\t1'].join('\n'));
  await expect(
    page.getByText(fill(tr.cutList.paste.summary, { valid: 1, invalid: 1, lines: '3' })),
  ).toBeVisible();
});
