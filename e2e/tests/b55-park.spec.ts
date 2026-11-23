import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { watchConsole } from './wizard-helpers';

/**
 * T309 (D-097): park point of a manual tool change in machine coordinates (G53). The machine form
 * shows the toggle for a manual changer, refuses a point outside the travel, saves a valid one,
 * and the field-test kit then names the park point.
 */
const t = tr.machines;
const f = t.form.fields;

test('machine form: park toggle, out-of-travel error, saved point in the field kit', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const problems = watchConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const list = (await (await request.get('/api/machines')).json()) as { id: string }[];
  const seeded = (await (await request.get(`/api/machines/${list[0]?.id}`)).json()) as {
    profile: {
      example: boolean;
      identity: { name: string };
      post: { id: string; version: string };
      toolChanger: { type: string; capacity: number; lengthCompensation: boolean };
      workEnvelope: { x: number; y: number };
    };
  };
  const profile = structuredClone(seeded.profile);
  profile.example = false;
  const name = `Park ${Math.random().toString(36).slice(2, 8)}`;
  profile.identity.name = name;
  profile.post = { id: 'mach3', version: '1.0.0' };
  profile.toolChanger = { type: 'manual', capacity: 1, lengthCompensation: false };
  const created = await request.post('/api/machines', { data: { profile } });
  expect(created.status()).toBe(201);
  const machine = (await created.json()) as { id: string };

  await page.goto('/makineler');
  await page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name, exact: false }) })
    .getByRole('button', { name: `${t.edit}: ${name}` })
    .click();
  await expect(page.getByLabel(f.name)).toHaveValue(name);
  await expect(page.getByTestId('park-unavailable')).toHaveCount(0);
  await expect(page.getByLabel(f.parkX)).toHaveCount(0);
  await page.getByLabel(f.park).check();

  // Outside the X travel (machine coordinates): a field error, nothing saved.
  await page.getByLabel(f.parkX).fill(String(profile.workEnvelope.x + 100));
  await page.getByLabel(f.parkY).fill('900');
  await page.getByRole('button', { name: t.form.save }).click();
  await expect(page.getByLabel(f.parkX)).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText(t.errors.parkOutOfTravel).first()).toBeVisible();

  // A negative value within the travel is fine (controllers that home to the max end).
  await page.getByLabel(f.parkX).fill('-50');
  await page.getByRole('button', { name: t.form.save }).click();
  await expect(page.getByText(t.form.saved.replace('{version}', '2'))).toBeVisible();

  const saved = (await (await request.get(`/api/machines/${machine.id}`)).json()) as {
    profile: { toolChanger: { park?: { enabled: boolean; x: number; y: number } } };
  };
  expect(saved.profile.toolChanger.park).toEqual({ enabled: true, x: -50, y: 900 });

  await page.goto(`/makineler/${machine.id}/saha-kiti`);
  const park = page.getByTestId('field-kit-park');
  await expect(park).toContainText(tr.fieldKit.park.on.replace('{x}', '-50').replace('{y}', '900'));
  expect(problems).toEqual([]);
});
