import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };

/**
 * B55 tester (T309): the machine form's park fields at 1440 and 390, light and dark: axe clean,
 * no page-level horizontal scroll, keyboard reaches the toggle and the X/Y fields; an automatic
 * changer shows no park fields.
 */
const t = tr.machines;
const f = t.form.fields;

async function newMachine(
  request: import('@playwright/test').APIRequestContext,
  changer: 'manual' | 'auto',
) {
  const list = (await (await request.get('/api/machines')).json()) as { id: string }[];
  const seeded = (await (await request.get(`/api/machines/${list[0]?.id}`)).json()) as {
    profile: Record<string, unknown> & { identity: { name: string } };
  };
  const profile = structuredClone(seeded.profile);
  profile.example = false;
  const name = `ParkT ${Math.random().toString(36).slice(2, 8)}`;
  profile.identity = { ...profile.identity, name };
  profile.post = { id: 'mach3', version: '1.0.0' };
  profile.toolChanger =
    changer === 'manual'
      ? { type: 'manual', capacity: 1, lengthCompensation: false }
      : { type: 'auto', capacity: 8, lengthCompensation: true };
  const created = await request.post('/api/machines', { data: { profile } });
  expect(created.status()).toBe(201);
  return name;
}

async function openForm(page: import('@playwright/test').Page, name: string) {
  await page.goto('/makineler');
  await page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name, exact: false }) })
    .getByRole('button', { name: `${t.edit}: ${name}` })
    .click();
  await expect(page.getByLabel(f.name)).toHaveValue(name);
}

test('B55 tester: automatic changer shows no park fields', async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openForm(page, await newMachine(request, 'auto'));
  await expect(page.getByLabel(f.park)).toHaveCount(0);
  await expect(page.getByLabel(f.parkX)).toHaveCount(0);
});

for (const width of [1440, 390]) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`B55 tester: park fields ${width} ${scheme}, keyboard, axe`, async ({ page, request }) => {
      test.setTimeout(120_000);
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      // The list is a table at desktop width; open the form there, then narrow the window.
      await page.setViewportSize({ width: 1440, height: 900 });
      await openForm(page, await newMachine(request, 'manual'));
      await page.setViewportSize({ width, height: 900 });
      const toggle = page.getByLabel(f.park);
      await toggle.focus();
      await page.keyboard.press('Space');
      await expect(toggle).toBeChecked();
      await page.keyboard.press('Tab');
      await expect(page.getByLabel(f.parkX)).toBeVisible();
      await page.getByLabel(f.parkX).scrollIntoViewIfNeeded();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
      await page.screenshot({ path: `__screenshots__/b55-park-${width}-${scheme}.png` });
      const res = await new AxeBuilder({ page }).analyze();
      const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
      expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
    });
  }
}
