import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { chooseMachine, openNewProject, pickOption } from './wizard-helpers';

// B12a tester (T265): the "starting values" row of the machine form and the Malzemeler chip, at
// 1440 / 1024 (light, dark) and a 390 smoke: no sideways page scroll, axe serious/critical clean.
// Review captures go to e2e/__screenshots__/ (git-ignored).

async function newMachine(request: APIRequestContext, name: string) {
  const list = (await (await request.get('/api/machines')).json()) as { id: string }[];
  const first = list[0];
  if (!first) throw new Error('no seeded machine');
  const seeded = (await (await request.get(`/api/machines/${first.id}`)).json()) as {
    profile: Record<string, unknown> & { identity: Record<string, unknown> };
  };
  const profile = structuredClone(seeded.profile);
  profile.example = false;
  profile.identity = { ...profile.identity, name };
  const res = await request.post('/api/machines', { data: { profile } });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function axeClean(page: Page) {
  const res = await new AxeBuilder({ page }).analyze();
  const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
}

async function noPageScroll(page: Page) {
  const extra = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(extra).toBeLessThanOrEqual(0);
}

test('B12a tester: unverified row from the fix flow, 1440/1024/390, light/dark', async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const name = `B12a test ${Date.now()}`;
  await newMachine(request, name);

  // Fix flow for 4 mm acrylic: the step-down starts at 4, not 6.
  await openNewProject(page, 'makine');
  await chooseMachine(page, name);
  await pickOption(page.getByTestId('wizard-material'), tr.materials.acrylic);
  const thick = page.getByTestId('wizard-thickness');
  await thick.fill('4');
  await thick.press('Enter');
  await expect(page.getByTestId('no-cutting-params')).toBeVisible();
  await page.getByTestId('add-cutting-params').click();
  await expect(page.getByTestId('machine-form')).toBeVisible({ timeout: 30_000 });
  const row = page.getByTestId('materials-table').locator('tbody tr:not([data-detail])').last();
  await expect(row.getByTestId('material-unverified-note')).toBeVisible();
  const n = async (sel: string) =>
    Number((await row.locator(sel).inputValue()).replace(/\./g, '').replace(',', '.'));
  const thickness = await n('[id$="-thickness"]');
  expect(thickness).toBe(4);
  expect(await n('[id$="-stepDown"]')).toBe(4);

  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const [w, h] of [
      [1440, 900],
      [1024, 768],
    ] as const) {
      await page.setViewportSize({ width: w, height: h });
      await row.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `__screenshots__/b12a-unverified-row-${w}-${scheme}.png` });
    }
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await axeClean(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await row.scrollIntoViewIfNeeded();
  await noPageScroll(page);
  await page.screenshot({ path: '__screenshots__/b12a-unverified-row-390.png' });
  await page.setViewportSize({ width: 1440, height: 900 });

  // Saved without confirming: the set is stored with its mark.
  await page.getByRole('button', { name: tr.machines.form.save, exact: true }).click();
  await expect(page.getByTestId('param-fix-saved')).toBeVisible({ timeout: 30_000 });
});

test('B12a tester: Malzemeler chip says Doğrulanmadı, never a green Tamam', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  // A machine whose sets cover every thickness of one library entry, all unverified.
  const lib = (await (await request.get('/api/materials')).json()) as {
    kind: string;
    thicknesses: number[];
  }[];
  const entry = lib.find((m) => m.thicknesses.length > 0);
  if (!entry) throw new Error('no library entry');
  const list = (await (await request.get('/api/machines')).json()) as { id: string }[];
  const seeded = (await (await request.get(`/api/machines/${list[0]?.id}`)).json()) as {
    profile: {
      example: boolean;
      identity: Record<string, unknown>;
      materials: Record<string, unknown>[];
    };
  };
  const profile = structuredClone(seeded.profile);
  const name = `B12a çip ${Date.now()}`;
  profile.example = false;
  profile.identity = { ...profile.identity, name };
  const base = profile.materials[0] ?? {};
  profile.materials = [
    ...profile.materials.filter((m) => m.material !== entry.kind),
    ...entry.thicknesses.map((thickness) => {
      const rest: Record<string, unknown> = { ...base };
      delete rest.copiedFrom;
      return {
        ...rest,
        material: entry.kind,
        thickness,
        stepDown: Math.min(6, thickness),
        unverified: true,
      };
    }),
  ];
  const res = await request.post('/api/machines', { data: { profile } });
  expect(res.status(), await res.text()).toBe(201);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/ayarlar/malzemeler');
  const chip = page
    .getByTestId('material-params')
    .locator('[data-status="unverified"]')
    .filter({ hasText: name });
  await expect(chip.first()).toBeVisible({ timeout: 30_000 });
  await expect(chip.first()).toContainText(tr.materialLibrary.statusUnverified);
  await page.screenshot({ path: '__screenshots__/b12a-malzemeler-1440.png' });
  await axeClean(page);
});
