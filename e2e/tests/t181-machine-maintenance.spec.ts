import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };

/**
 * T181: manual maintenance log with a reminder badge on Makineler and Ana sayfa; the controller
 * library pre-fills a new machine profile from the post config (generic, Mach3).
 */
const t = tr.machines.maintenance;

async function newMachine(request: APIRequestContext, name: string): Promise<string> {
  const list = (await (await request.get('/api/machines')).json()) as { id: string }[];
  const first = list[0];
  if (!first) throw new Error('no seeded machine');
  const seeded = (await (await request.get(`/api/machines/${first.id}`)).json()) as {
    profile: { example: boolean; identity: Record<string, unknown> };
  };
  const profile = structuredClone(seeded.profile);
  profile.example = false;
  profile.identity = { ...profile.identity, name };
  const res = await request.post('/api/machines', { data: { profile } });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function axeClean(page: Page, include: string) {
  const res = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .include(include)
    .analyze();
  const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
}

test('overdue reminder on Makineler and Ana sayfa; recording maintenance clears it', async ({
  page,
  request,
}) => {
  await page.clock.setFixedTime(new Date('2026-11-20T10:00:00'));
  await page.setViewportSize({ width: 1440, height: 900 });
  const name = `Bakım ${Math.random().toString(36).slice(2, 8)}`;
  const id = await newMachine(request, name);
  const res = await request.post(`/api/machines/${id}/maintenance`, {
    data: { date: '2020-01-01', intervalDays: 30, note: 'ilk' },
  });
  expect(res.status()).toBe(200);

  // Ana sayfa (server-rendered): the overdue machine carries the reminder.
  await page.goto('/');
  const homeRow = page.getByTestId('home-machines').locator('li', { hasText: name });
  await expect(homeRow.getByTestId('home-maintenance')).toContainText(t.overdue);

  await page.goto('/makineler');
  const row = page.getByRole('row', { name: new RegExp(name) });
  const cell = row.getByTestId('machine-maintenance');
  await expect(cell).toContainText(t.overdue);
  await cell.click();
  const dialog = page.getByTestId('maintenance-dialog');
  await expect(dialog.getByTestId('maintenance-history')).toContainText('ilk');
  await expect(dialog.getByTestId('maintenance-date')).toHaveValue('2026-11-20');
  await expect(dialog.getByTestId('maintenance-interval')).toHaveValue('30');
  await axeClean(page, '[data-testid="maintenance-dialog"]');

  await dialog.getByTestId('maintenance-interval').fill('5');
  await dialog.getByTestId('maintenance-note').fill('kayış kontrolü');
  await dialog.getByTestId('maintenance-save').click();
  await expect(dialog.getByTestId('maintenance-dialog-status')).toContainText(t.soon);
  await expect(dialog.getByTestId('maintenance-history').locator('li').first()).toContainText(
    'kayış kontrolü',
  );
  await dialog.getByRole('button', { name: t.cancel }).click();
  await expect(cell).toContainText(t.soon);
});

test('controller library pre-fills a new machine from the Mach3 post config', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/makineler?yeni=1');
  const f = tr.machines.form.fields;
  await page.getByLabel(f.name).fill('Kütüphaneden');
  await page.getByTestId('machine-library').click();
  await page.getByRole('option', { name: 'Mach3' }).click();
  await expect(page.getByLabel(f.controllerFamily)).toHaveValue('Mach3');
  await expect(page.getByLabel(f.name)).toHaveValue('Kütüphaneden');
  await page.getByTestId('machine-library').click();
  await page.getByRole('option', { name: 'Genel düz G-code' }).click();
  await expect(page.getByLabel(f.controllerFamily)).toHaveValue('Genel düz G-code');
});
