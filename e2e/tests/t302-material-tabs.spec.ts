import { expect, test, type APIRequestContext } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  chooseMachine,
  fill,
  goStep,
  openNewProject,
  pasteAndNest,
  saved,
  wizardReady,
} from './wizard-helpers';

// T302 (CTO #12 E3): tab defaults in the machine's material set. Kesim ayarları names the
// inherited sizes and links to the set's tab fields; the form refuses sizes below the T293 bounds
// and says the bound; a saved set is what the project's panel then shows.

const c = tr.simulation.cutting;
const tt = tr.machines.form.tabs;
const errors = tr.machines.errors;

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

test('T302: material-set tab defaults: link lands on them, bounds, values reach the panel', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const name = `T302 test ${Date.now()}`;
  await newMachine(request, name);

  await openNewProject(page, 'makine');
  await chooseMachine(page, name);
  await pasteAndNest(page, 'Ad\tEn\tBoy\tAdet\nYan\t560\t720\t1\nTakoz\t80\t80\t2', 2, 'makine');
  await saved(page);
  await goStep(page, 'simulasyon');
  const source = page.getByTestId('sim-cutting-source');
  await expect(source).toContainText(
    fill(c.source.default, { count: 4, width: '10', height: '3' }),
    { timeout: 30_000 },
  );

  // "Malzeme ayarında değiştir" opens the machine form at the set's tab switch.
  await page.getByTestId('sim-cutting-edit-material').click();
  await expect(page.getByTestId('machine-form')).toBeVisible({ timeout: 30_000 });
  // One switch per set: the focused one is the project's set (MDF 18).
  const focused = page.locator('[role="checkbox"]:focus');
  await expect(focused).toHaveAccessibleName(tt.own);
  const index = /^f-materials-(\d+)-tabs$/.exec((await focused.getAttribute('id')) ?? '')?.[1];
  expect(index).toBeDefined();
  const detail = page.getByTestId(`material-tabs-${index}`);
  const own = detail.getByRole('checkbox', { name: tt.own });
  await expect(detail.getByText(/Boş: hazır varsayılan geçerli, 4 adet × 10 mm/)).toBeVisible();
  await own.check();
  const width = detail.getByLabel(tt.width);
  const height = detail.getByLabel(tt.height);
  const count = detail.getByLabel(tt.count);
  await width.fill('2');
  await height.fill('17,5');
  const save = page.getByRole('button', { name: tr.machines.form.save, exact: true });
  await save.click();
  await expect(detail.getByText(fill(errors.min, { min: '3' }))).toBeVisible();
  await expect(detail.getByText(fill(errors.max, { max: '17' }))).toBeVisible();
  await expect(page.getByTestId('param-fix-saved')).toHaveCount(0);

  await count.fill('6');
  await width.fill('12');
  await height.fill('2');
  await save.click();
  const done = page.getByTestId('param-fix-saved');
  await expect(done).toBeVisible({ timeout: 30_000 });
  await done.getByTestId('param-fix-return').click();
  await wizardReady(page, 'simulasyon');
  await expect(source).toContainText(
    fill(c.source.material, { count: 6, width: '12', height: '2' }),
    { timeout: 30_000 },
  );

  // A project value: "Malzeme ayarına dön" names the set's sizes and goes back to them.
  const w = page.getByTestId('sim-cutting-width');
  await w.fill('15');
  await w.press('Enter');
  await expect(source).toContainText(c.source.project);
  const reset = page.getByTestId('sim-cutting-reset');
  await expect(reset).toHaveText(fill(c.reset, { count: 6, width: '12', height: '2' }));
  await reset.click();
  await expect(source).toContainText(
    fill(c.source.material, { count: 6, width: '12', height: '2' }),
  );
});
