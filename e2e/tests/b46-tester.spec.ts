import { expect, test, type APIRequestContext } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { expectNoA11yViolations } from './visual/helpers';
import {
  chooseMachine,
  fill,
  goStep,
  openNewProject,
  pasteAndNest,
  projectId,
  saved,
} from './wizard-helpers';

// B46 tester (polish P3 + P4): refused values are never stored, the archived-machine note on the
// three steps, and the DXF dialog returns focus to its opener.

const d = tr.settings.general.defaults;

test('Ayarlar: 150 mm gap says the range and Kaydet never stores it', async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const before = await (await request.get('/api/settings')).text();
  await page.goto('/ayarlar');
  const gap = page.getByTestId('settings-default-gap');
  const old = await gap.inputValue();
  await gap.fill('150');
  await expect(page.getByText(fill(d.range, { max: '100' }))).toBeVisible();
  await expectNoA11yViolations(page);
  const save = page.getByTestId('settings-default-save');
  if (await save.isEnabled()) await save.click();
  await page.reload();
  await expect(page.getByTestId('settings-default-gap')).toHaveValue(old);
  const after = await (await request.get('/api/settings')).text();
  expect(after).toBe(before);
});

test('offcut dialog: out-of-range sizes say the range; nothing stored', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const count = async () =>
    ((await (await request.get('/api/offcuts')).json()) as unknown[]).length;
  const n0 = await count();
  await page.goto('/projeler');
  await page.getByTestId('offcuts-tab').click();
  await page.getByTestId('offcut-add').click();
  const dialog = page.getByTestId('offcut-dialog');
  for (const key of ['width', 'height'] as const) {
    await dialog.getByTestId(`offcut-form-${key}`).fill('10001');
  }
  await dialog.getByTestId('offcut-form-thickness').fill('0');
  const range = fill(tr.projects.offcuts.form.range, { max: (10000).toLocaleString('tr-TR') });
  await expect(dialog.getByText(range).first()).toBeVisible();
  await dialog.getByTestId('offcut-form-save').click();
  await expect(dialog.getByTestId('offcut-form-message')).toBeVisible();
  await expect(dialog).toBeVisible();
  await expectNoA11yViolations(page);
  expect(await count()).toBe(n0);
});

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

test('archived machine: note on step 1, Simülasyon and Dışa aktar; absent for a live machine', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const name = `Arşiv B46 ${Math.random().toString(36).slice(2, 7)}`;
  const mid = await newMachine(request, name);
  await openNewProject(page, 'makine');
  await chooseMachine(page, name);
  await pasteAndNest(page, 'Ad\tEn\tBoy\tAdet\nYan\t560\t720\t1', 1, 'makine');
  await saved(page);
  const id = await projectId(page);
  for (const step of ['makine', 'simulasyon', 'export'] as const) {
    await goStep(page, step);
    await expect(page.getByTestId('machine-archived-notice')).toHaveCount(0);
  }
  expect((await request.patch(`/api/machines/${mid}`, { data: { archived: true } })).status()).toBe(
    200,
  );
  const note = tr.wizard.machine.archivedNote;
  for (const step of ['makine', 'simulasyon', 'export'] as const) {
    await page.goto(`/projeler/${id}?adim=${step}`);
    const n = page.getByTestId('machine-archived-notice').filter({ visible: true });
    await expect(n, step).toHaveCount(1, { timeout: 30_000 });
    await expect(n).toContainText(note.slice(0, 25));
  }
  await expectNoA11yViolations(page);
  await request.patch(`/api/machines/${mid}`, { data: { archived: false } });
});

test('DXF dialog: Escape and Vazgeç return focus to "DXF içe aktar"', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  const open = page.getByTestId('dxf-open').filter({ visible: true });
  await open.click();
  await expect(page.getByTestId('dxf-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('dxf-dialog')).toHaveCount(0);
  await expect(open).toBeFocused();
  await open.press('Enter');
  await expect(page.getByTestId('dxf-dialog')).toBeVisible();
  await page
    .getByTestId('dxf-dialog')
    .getByRole('button', { name: /Vazgeç|Kapat/ })
    .first()
    .click();
  await expect(open).toBeFocused();
});
