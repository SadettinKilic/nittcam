import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { expectNoA11yViolations } from './visual/helpers';
import { watchConsole } from './wizard-helpers';

/**
 * T191: the field-test kit page of a machine: reached from Doğrulama, filled from the profile, the
 * extended air cut downloads (with the acceptance) and is recorded; the print button prints.
 */
const k = tr.fieldKit;

test('field-test kit: sections, measurement form, extended air cut recorded', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const problems = watchConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  // A fresh, non-example machine (its download log starts empty).
  const list = (await (await request.get('/api/machines')).json()) as { id: string }[];
  const seeded = (await (await request.get(`/api/machines/${list[0]?.id}`)).json()) as {
    profile: { example: boolean; identity: { name: string } };
  };
  const profile = structuredClone(seeded.profile);
  profile.example = false;
  profile.identity.name = `Saha kiti ${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post('/api/machines', { data: { profile } });
  expect(created.status()).toBe(201);
  const machine = (await created.json()) as { id: string };

  await page.goto(`/makineler/${machine.id}/dogrulama`);
  await page.getByTestId('verification-field-kit').click();
  await expect(page).toHaveURL(new RegExp(`/makineler/${machine.id}/saha-kiti$`));
  const kit = page.getByTestId('field-kit');
  await expect(page.getByRole('heading', { level: 1, name: k.title })).toBeVisible();
  await expect(page.getByTestId('field-kit-subtitle')).toContainText(profile.identity.name);
  for (const id of ['before', 'bring', 'air', 'cut', 'park', 'extended', 'form', 'record']) {
    await expect(kit.getByTestId(`field-kit-${id}`)).toBeVisible();
  }
  await expect(page.getByTestId('field-kit-row')).toHaveCount(12);
  await expect(page.getByTestId('field-kit-target-holePitch')).toHaveText('100');
  await expect(page.getByTestId('field-kit-target-cornerRadius')).toHaveText('R 20');
  // The test cut waits for the air cut (§7.3 order).
  await expect(page.getByTestId('field-kit-ext-cut-blocked')).toHaveText(k.extended.blocked);
  await expect(page.getByTestId('field-kit-downloads')).toContainText(k.downloads.empty);
  await expectNoA11yViolations(page);

  // Extended air cut: the acceptance opens the download; the file is recorded.
  await expect(page.getByTestId('field-kit-ext-air-download')).toBeDisabled();
  await page.getByTestId('field-kit-ext-air-accept').click();
  const [d] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('field-kit-ext-air-download').click(),
  ]);
  expect(d.suggestedFilename()).toContain('AIRCUT_GENIS');
  const first = (await readFile(await d.path())).toString('utf8').split('\n')[0] ?? '';
  expect(first).toContain('DOGRULANMADI, once air cut');
  await page.reload();
  const row = page.getByTestId('field-kit-download');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(k.downloads.kinds.extAirCut);
  await expect(row).toContainText(d.suggestedFilename());

  // "Yazdır" opens the print dialog (stubbed: the call is what matters).
  await page.evaluate(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => {
      (window as unknown as { printed: number }).printed += 1;
    };
  });
  await page.getByTestId('field-kit-print').click();
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
  expect(problems).toEqual([]);
});
