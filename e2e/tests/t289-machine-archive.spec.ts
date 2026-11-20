import { expect, test, type APIRequestContext } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  chooseMachine,
  fill,
  goStep,
  openNewProject,
  paste,
  projectId,
  saved,
  watchConsole,
  wizardReady,
} from './wizard-helpers';

/**
 * T289: "Arşivle" on Makineler with a "Geri al" toast; an archived machine leaves the new-project
 * picker and the Ana sayfa machine list, but a project bound to it still opens on it; "Geri yükle"
 * brings it back.
 */
const t = tr.machines.archive;

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

test('archive a machine, undo, archive again: gone from new projects and Ana sayfa, old project opens', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const problems = watchConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const name = `Arşiv ${Math.random().toString(36).slice(2, 8)}`;
  await newMachine(request, name);

  // An old project on that machine.
  await openNewProject(page, 'makine');
  await chooseMachine(page, name);
  await goStep(page, 'parcalar');
  await paste(page, ['Parça adı\tEn\tBoy\tAdet', 'Raf\t500\t300\t2'].join('\n'), 1);
  await saved(page);
  const id = await projectId(page);

  // Archive: no confirm dialog, the row leaves the list, the toast offers "Geri al".
  await page.goto('/makineler');
  const list = page.getByTestId('machine-list');
  const archive = page.getByRole('button', { name: `${t.action}: ${name}` }).first();
  await expect(list.getByText(name).first()).toBeVisible();
  await archive.click();
  await expect(list.getByText(name)).toHaveCount(0);
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: fill(t.archived, { name }) });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: t.undo }).click();
  await expect(page.getByText(fill(t.restored, { name }))).toBeVisible();
  await expect(list.getByText(name).first()).toBeVisible();

  // Archive again and reload: listed under "Arşivlenen makineler".
  await archive.click();
  await expect(list.getByText(name)).toHaveCount(0);
  await page.reload();
  const archived = page.getByTestId('machine-archived');
  await archived.locator('summary').click();
  await expect(archived.getByText(name)).toBeVisible();

  // Ana sayfa: not in the machine list.
  await page.goto('/');
  await expect(page.getByTestId('home-machines')).toBeVisible();
  await expect(page.getByTestId('home-machines').getByText(name)).toHaveCount(0);

  // New project: not offered.
  await openNewProject(page, 'makine');
  await page.getByTestId('wizard-machine').click();
  await expect(page.getByRole('option').first()).toBeVisible();
  await expect(page.getByRole('option', { name: new RegExp(name) })).toHaveCount(0);
  await page.keyboard.press('Escape');

  // The old project still opens on the archived machine.
  await page.goto(`/projeler/${id}?adim=makine`);
  await wizardReady(page, 'makine');
  await expect(page.getByTestId('wizard-machine')).toContainText(name);

  // "Geri yükle" brings it back.
  await page.goto('/makineler');
  await page.getByTestId('machine-archived').locator('summary').click();
  await page.getByRole('button', { name: `${t.restore}: ${name}` }).click();
  await expect(page.getByText(fill(t.restored, { name }))).toBeVisible();
  await expect(page.getByTestId('machine-list').getByText(name).first()).toBeVisible();
  expect(problems).toEqual([]);
});
