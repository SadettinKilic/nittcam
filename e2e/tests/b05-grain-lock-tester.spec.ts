import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  fill,
  goStep,
  openGrainedProject,
  pasteAndNest,
  pickOption,
  projectId,
  saved,
} from './wizard-helpers';

/**
 * B5 tester (rounds 2–3): a copy the grain no longer allows shows the Turkish error on Dizilim
 * (LOCKED_PLACEMENT_GRAIN when locked, PLACEMENT_GRAIN when not) and blocks the NC export.
 */

const l = tr.layout;
const SHELF = ['Parça adı\tEn\tBoy\tAdet\tDamar', 'Yan dikme\t300\t1800\t2\tevet'].join('\n');
const LABEL = '1.1 · Yan dikme';

test('lock, turn the sheet grain, LOCKED_PLACEMENT_GRAIN; unlock → PLACEMENT_GRAIN; Yerleşimi yenile clears it', async ({
  page,
}) => {
  await openGrainedProject(page);
  const g0 = page.getByTestId('sheet-grain-dial-quick-0');
  await g0.click();
  await pasteAndNest(page, SHELF, 1, 'makine');
  await expect(page.getByTestId('layout-canvas')).toHaveAttribute('data-part-count', '2');

  await pickOption(page.getByTestId('layout-select'), LABEL);
  await page.getByRole('button', { name: l.info.lock }).click();
  await expect(page.getByTestId('layout-info-locked')).toHaveText(l.info.lockedYes);

  const msg = fill(l.lockedGrainIssue, { label: LABEL });
  await expect(page.getByRole('alert').filter({ hasText: 'damar yönüne uymuyor' })).toHaveCount(0);

  await goStep(page, 'makine');
  await page.getByTestId('sheet-grain-dial-quick-90').click();
  await goStep(page, 'dizilim');
  const alert = page.getByRole('alert').filter({ hasText: 'damar yönüne uymuyor' });
  await expect(alert).toHaveCount(1);
  await expect(alert).toHaveText(msg);

  // Re-nest keeps the lock and the error.
  await page.getByRole('button', { name: l.renest }).click();
  await expect(page.getByRole('button', { name: l.renest })).toBeEnabled();
  await expect(alert).toHaveCount(1);

  // Unlock (round 3): the copy is now reported as PLACEMENT_GRAIN, one alert, never both codes.
  await pickOption(page.getByTestId('layout-select'), LABEL);
  await page.getByRole('button', { name: l.info.unlock }).click();
  await expect(alert).toHaveCount(0);
  const stale = page.getByRole('alert').filter({ hasText: 'damara ters duruyor' });
  await expect(stale).toHaveCount(1);
  await expect(stale).toContainText(fill(l.placementGrainIssue, { label: LABEL }));
  await expect(page.getByRole('alert').filter({ hasText: LABEL })).toHaveCount(1);

  // "Yerleşimi yenile" re-nests the copy at an allowed rotation and clears the error.
  await stale.getByRole('button', { name: l.renestStale }).click();
  await expect(stale).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: LABEL })).toHaveCount(0);
});

test('stale rotation after a sheet grain change: export refused (422, Turkish); re-nest → 201', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openGrainedProject(page);
  await page.getByTestId('sheet-grain-dial-quick-0').click();
  await pasteAndNest(page, SHELF, 1, 'makine');
  await expect(page.getByTestId('layout-canvas')).toHaveAttribute('data-part-count', '2');

  // Turn the sheet grain, skip Diz, go straight to export.
  await goStep(page, 'makine');
  await page.getByTestId('sheet-grain-dial-quick-90').click();
  await saved(page);
  const id = await projectId(page);
  await goStep(page, 'export');
  await expect(page.getByTestId('export-status')).toHaveAttribute('data-ok', 'false', {
    timeout: 30_000,
  });
  const listed = page.getByTestId('export-violations');
  await expect(listed).toContainText('damara ters duruyor');
  await expect(listed).not.toContainText('Kilitli parça');

  const revision = Number(await page.getByTestId('save-status').getAttribute('data-revision'));
  const refused = await page.request.post(`/api/projects/${id}/export`, {
    data: { revision, acceptUnverified: true },
  });
  expect(refused.status()).toBe(422);
  const body = (await refused.json()) as { violations: { code: string; message: string }[] };
  expect(body.violations.length).toBeGreaterThan(0);
  expect(body.violations.length).toBeLessThanOrEqual(2);
  for (const v of body.violations) {
    expect(v.code).toBe('PLACEMENT_GRAIN');
    expect(v.message).toMatch(/yeniden dizin/);
  }
  const history = await page.request.get(`/api/projects/${id}/exports`);
  expect(history.status()).toBe(200);
  expect(await history.json()).toEqual([]);

  // Dizilim: one PLACEMENT_GRAIN alert per stale copy; the button re-nests and clears them.
  await goStep(page, 'dizilim');
  const stale = page.getByRole('alert').filter({ hasText: 'damara ters duruyor' });
  await expect(stale).toHaveCount(body.violations.length);
  await stale.first().getByRole('button', { name: l.renestStale }).click();
  await expect(stale).toHaveCount(0);
  await expect(page.getByTestId('save-status')).not.toHaveAttribute(
    'data-revision',
    String(revision),
    { timeout: 15_000 },
  );
  await saved(page);
  const fixed = Number(await page.getByTestId('save-status').getAttribute('data-revision'));
  const ok = await page.request.post(`/api/projects/${id}/export`, {
    data: { revision: fixed, acceptUnverified: true },
  });
  expect(ok.status()).toBe(201);
});
