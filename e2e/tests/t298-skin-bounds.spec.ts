import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  fill,
  goStep,
  openNewProject,
  pasteAndNest,
  projectId,
  saved,
  wizardReady,
} from './wizard-helpers';

// T298 (CTO #12 A, D-083): a thin skin below 0.2 mm or above thickness − 1 mm does not hold a
// small part. The step-1 field refuses it with the range; a hand-edited project with such a skin
// is blocked on Simülasyon, and the finding leads back to the field.

const skin = tr.wizard.machine.skin;

test('T298: skin field refuses 0,05 and 17,99 with the range; hand-edited 0,001 is blocked', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page, 'Ad\tEn\tBoy\tAdet\nYan\t560\t720\t1\nTakoz\t80\t80\t2', 2);
  await saved(page);

  await goStep(page, 'makine');
  await page.getByTestId('thin-skin-switch').click();
  const field = page.getByTestId('thin-skin-thickness');
  await expect(field).toHaveValue('0,5');
  const range = fill(skin.bounds, { min: '0,2', max: '17' });
  for (const v of ['0,05', '17,99']) {
    await field.fill(v);
    await field.press('Enter');
    await expect(page.getByTestId('thin-skin').getByText(range)).toBeVisible();
  }
  await field.fill('0,2');
  await field.press('Enter');
  await expect(page.getByTestId('thin-skin').getByText(range)).toHaveCount(0);
  await saved(page);

  // Old / hand-edited project: 0.001 mm skin straight into the project JSON.
  const id = await projectId(page);
  const cur = (await (await request.get(`/api/projects/${id}`)).json()) as {
    revision: number;
    project: { cutting: { skin?: { thickness: number } } };
  };
  cur.project.cutting.skin = { thickness: 0.001 };
  const put = await request.put(`/api/projects/${id}`, {
    data: { project: cur.project, baseRevision: cur.revision, commands: [] },
  });
  expect(put.status()).toBe(200);

  await page.goto(`/projeler/${id}?adim=simulasyon`);
  await wizardReady(page, 'simulasyon');
  const finding = page
    .locator('[data-testid="violation"][data-code="SMALL_PART_SKIN_OUT_OF_BOUNDS"]')
    .first();
  await expect(finding).toBeVisible({ timeout: 30_000 });
  await finding.getByTestId('violation-open-skin').click();
  await expect(page).toHaveURL(/adim=makine/);
  await expect(page.getByTestId('thin-skin-thickness')).toBeFocused();

  // Dışa aktar shows the same finding with the same way back.
  await goStep(page, 'export');
  await expect(page.getByTestId('export-violation-open-skin').first()).toBeVisible({
    timeout: 30_000,
  });
});
