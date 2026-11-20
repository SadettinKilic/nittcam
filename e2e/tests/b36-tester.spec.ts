import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  chooseMachine,
  fill,
  goStep,
  nest,
  openCutListAction,
  openNewProject,
  paste,
  pickOption,
  projectId,
  saved,
  toastsSettled,
  watchConsole,
  wizardReady,
} from './wizard-helpers';

/**
 * Tester (B36): T291 invalid sizes and plastics without grain, a deleted offcut is not offered to
 * the nesting; T292 parts equal the excluded ones, both projects nest and export, the link goes
 * when the source is deleted; axe + screenshots on Makineler, Artık parçalar, cabinet dialog.
 */
const o = tr.projects.offcuts;
const c = tr.cutList.cabinet;

async function axeClean(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running'),
  );
  await toastsSettled(page);
  const res = await new AxeBuilder({ page }).analyze();
  const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
  expect(bad.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
}
const noHScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

interface Part {
  name: string;
  qty: number;
  note?: string;
  grain?: unknown;
  edgeBand?: unknown;
  params: { w: number; h: number };
}
interface Detail {
  revision: number;
  project: { stock: { material: string; thickness: number }; parts: Part[]; machine: unknown };
}
const detail = async (request: APIRequestContext, id: string) =>
  (await (await request.get(`/api/projects/${id}`)).json()) as Detail;

async function newMachine(request: APIRequestContext, name: string, mdf8 = false): Promise<string> {
  const list = (await (await request.get('/api/machines')).json()) as { id: string }[];
  const first = list[0];
  if (!first) throw new Error('no seeded machine');
  const seeded = (await (await request.get(`/api/machines/${first.id}`)).json()) as {
    profile: {
      example: boolean;
      identity: Record<string, unknown>;
      materials: { material: string; thickness: number; stepDown: number }[];
    };
  };
  const profile = structuredClone(seeded.profile);
  profile.example = false;
  profile.identity = { ...profile.identity, name };
  const mdf = profile.materials.find((m) => m.material === 'mdf' && m.thickness === 18);
  if (mdf8 && mdf) profile.materials.push({ ...mdf, thickness: 8, stepDown: 4 });
  const res = await request.post('/api/machines', { data: { profile } });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function exportOk(request: APIRequestContext, id: string) {
  const { revision } = await detail(request, id);
  const res = await request.post(`/api/projects/${id}/export`, {
    data: { revision, acceptUnverified: true },
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
  const body = (await res.json()) as { files: { downloadUrl: string }[] };
  const url = body.files[0]?.downloadUrl;
  if (!url) throw new Error('no exported file');
  const text = await (await request.get(url)).text();
  expect(text).toMatch(/G0|G1/);
  return text;
}

test('T291: invalid sizes refused, plastics have no grain, a deleted offcut is not offered', async ({
  page,
  request,
}) => {
  const problems = watchConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const base = { material: 'mdf', thickness: 18, width: 600, height: 400, grain: 0 };
  // API: every bad size is a 400 on create and on edit.
  for (const bad of [0, -5, 10_001, Number.NaN, '600']) {
    for (const key of ['width', 'height', 'thickness'] as const) {
      const res = await request.post('/api/offcuts', {
        data: { offcuts: [{ ...base, [key]: bad }] },
      });
      expect(res.status(), `${key}=${String(bad)}`).toBe(400);
    }
  }
  const made = await request.post('/api/offcuts', { data: { offcuts: [base] } });
  expect(made.status()).toBe(201);
  const [own] = (await made.json()) as { id: string }[];
  if (!own) throw new Error('no offcut');
  for (const bad of [{ width: 0 }, { height: 10_001 }, { thickness: -1 }, { grain: 45 }, {}]) {
    expect((await request.patch(`/api/offcuts/${own.id}`, { data: bad })).status()).toBe(400);
  }
  expect((await request.patch(`/api/offcuts/${own.id}`, { data: { deleted: 'x' } })).status()).toBe(
    400,
  );

  // UI: out-of-range size → message, dialog stays; acrylic → grain locked to "Damarsız".
  const w = 300 + Math.floor(Math.random() * 300);
  await page.goto('/projeler');
  await page.getByTestId('offcuts-tab').click();
  await page.getByTestId('offcut-add').click();
  const dialog = page.getByTestId('offcut-dialog');
  await dialog.getByTestId('offcut-form-width').fill('10001');
  await dialog.getByTestId('offcut-form-height').fill('211');
  await dialog.getByTestId('offcut-form-save').click();
  await expect(dialog.getByTestId('offcut-form-message')).toHaveText(o.form.invalid);
  await expect(dialog).toBeVisible();
  await pickOption(dialog.getByTestId('offcut-form-material'), tr.materials.acrylic);
  await expect(dialog.getByTestId('offcut-form-grain')).toBeDisabled();
  await expect(dialog.getByTestId('offcut-form-grain')).toHaveText(o.form.grainNone);
  await expect(dialog.getByText(o.form.grainNoneHint)).toBeVisible();
  await dialog.getByTestId('offcut-form-thickness').fill('5');
  await dialog.getByTestId('offcut-form-width').fill(String(w));
  await dialog.getByTestId('offcut-form-save').click();
  await expect(dialog).toHaveCount(0);
  const acrylic = (
    (await (await request.get('/api/offcuts?material=acrylic&thickness=5')).json()) as {
      width: number;
      height: number;
      grain: unknown;
    }[]
  ).find((x) => x.width === w && x.height === 211);
  expect(acrylic?.grain ?? null).toBeNull();

  // Deleted: gone from the query the Dizilim step uses, back after "Geri al" with the same id.
  const nestingQuery = '/api/offcuts?material=mdf&thickness=18&status=available';
  const ids = async () =>
    ((await (await request.get(nestingQuery)).json()) as { id: string }[]).map((x) => x.id);
  expect(await ids()).toContain(own.id);
  expect((await request.patch(`/api/offcuts/${own.id}`, { data: { deleted: true } })).ok()).toBe(
    true,
  );
  expect(await ids()).not.toContain(own.id);
  expect((await request.patch(`/api/offcuts/${own.id}`, { data: { deleted: false } })).ok()).toBe(
    true,
  );
  expect(await ids()).toContain(own.id);
  await request.patch(`/api/offcuts/${own.id}`, { data: { deleted: true } });
  expect(problems).toEqual([]);
});

test('T292: parts equal the excluded ones, both projects nest and export, link goes with the source', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const problems = watchConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const name = `Dolap ${Math.random().toString(36).slice(2, 8)}`;
  // The sample machine only has 18 mm cutting parameters: a copy with MDF 8 mm too, so the split
  // project can export (without them it stops on NO_CUTTING_PARAMS, which is the right answer).
  const machine = `B36 8mm ${Math.random().toString(36).slice(2, 7)}`;
  await newMachine(request, machine, true);
  await openNewProject(page, 'makine');
  await chooseMachine(page, machine);
  await goStep(page, 'parcalar');
  await paste(page, ['Parça adı\tEn\tBoy\tAdet', 'Raf\t500\t300\t2'].join('\n'), 1);
  const nameField = page.getByTestId('project-name');
  await nameField.fill(name);
  await nameField.press('Enter');
  await saved(page);
  const sourceId = await projectId(page);

  // Split the 8 mm back off.
  await page.getByTestId('cabinet-open').click();
  await page.getByTestId('cabinet-split').click();
  await expect(page.getByTestId('cabinet-split-thickness')).toHaveValue('8');
  await page.getByTestId('cabinet-add').click();
  await expect(page.getByTestId('project-links-derived')).toBeVisible();
  await saved(page);
  const newName = fill(c.split.projectName, { name, t: '8' });
  const derivedLink = page
    .getByTestId('project-links-derived')
    .getByRole('link', { name: newName });
  const href = await derivedLink.getAttribute('href');
  const newId = /([0-9a-f-]{36})/.exec(href ?? '')?.[1];
  if (!newId) throw new Error(`no derived id in ${href}`);

  // Same dialog defaults, now with "include other": the 8 mm back lands here with a note.
  await page.getByTestId('cabinet-open').click();
  await page.getByTestId('cabinet-include-other').click();
  await page.getByTestId('cabinet-add').click();
  await saved(page);
  const src = await detail(request, sourceId);
  const made = await detail(request, newId);
  const excluded = src.project.parts.filter((p) => p.note === '8 mm');
  expect(excluded.length).toBeGreaterThan(0);
  const shape = (p: Part) => ({
    name: p.name,
    qty: p.qty,
    w: p.params.w,
    h: p.params.h,
    grain: p.grain,
    edgeBand: p.edgeBand,
  });
  expect(made.project.parts.map(shape)).toEqual(excluded.map(shape));
  expect(made.project.parts.every((p) => p.note === undefined)).toBe(true);
  expect(made.project.stock.thickness).toBe(8);
  expect(made.project.machine).toEqual(src.project.machine);

  // Both nest and export.
  for (const id of [sourceId, newId]) {
    await page.goto(`/projeler/${id}?adim=dizilim`);
    await wizardReady(page, 'dizilim');
    await nest(page);
    await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 30_000 });
    await saved(page);
    await exportOk(request, id);
  }

  // Source deleted (soft): the derived project opens, its "Kaynak proje" line is gone.
  await page.goto(`/projeler/${newId}?adim=parcalar`);
  await wizardReady(page, 'parcalar');
  await expect(page.getByTestId('project-links-source')).toContainText(name);
  expect((await request.patch(`/api/projects/${sourceId}`, { data: { deleted: true } })).ok()).toBe(
    true,
  );
  expect(
    ((await (await request.get(`/api/projects/${newId}/links`)).json()) as { source: unknown })
      .source,
  ).toBeNull();
  await page.reload();
  await wizardReady(page, 'parcalar');
  await expect(page.getByTestId('project-links-source')).toHaveCount(0);
  // Restored: the link comes back.
  await request.patch(`/api/projects/${sourceId}`, { data: { deleted: false } });
  await page.reload();
  await wizardReady(page, 'parcalar');
  await expect(page.getByTestId('project-links-source')).toContainText(name);
  expect(problems).toEqual([]);
});

for (const vp of [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
]) {
  for (const scheme of vp.width > 600 ? (['light', 'dark'] as const) : (['light'] as const)) {
    test(`B36 screens: axe + layout at ${vp.name} ${scheme}`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.emulateMedia({ colorScheme: scheme });
      const shot = (n: string) =>
        page.screenshot({ path: `__screenshots__/b36-${n}-${vp.name}-${scheme}.png` });

      // Makineler with the archived list open (an archived copy of the sample, never the sample:
      // other specs of the shard pick the first machine).
      const name = `Arşiv B36 ${Math.random().toString(36).slice(2, 7)}`;
      const id = await newMachine(page.request, name);
      const res = await page.request.patch(`/api/machines/${id}`, { data: { archived: true } });
      expect(res.ok()).toBe(true);
      await page.goto('/makineler');
      await expect(page.getByTestId('machine-list')).toBeVisible();
      const archived = page.getByTestId('machine-archived');
      await archived.locator('summary').click();
      await expect(archived.getByText(name)).toBeVisible();
      await axeClean(page);
      expect(await noHScroll(page)).toBe(true);
      await shot('makineler');

      // Projeler → Artık parçalar, then the add dialog.
      await page.goto('/projeler');
      await page.getByTestId('offcuts-tab').click();
      await expect(page.getByTestId('offcut-add')).toBeEnabled();
      await axeClean(page);
      expect(await noHScroll(page)).toBe(true);
      await shot('artik');
      await page.getByTestId('offcut-add').click();
      await expect(page.getByTestId('offcut-dialog')).toBeVisible();
      await axeClean(page);
      await shot('artik-dialog');
      await page.keyboard.press('Escape');

      // Cabinet dialog with the split box open (saved project only).
      await openNewProject(page, 'parcalar');
      await paste(page, ['Parça adı\tEn\tBoy\tAdet', 'Raf\t500\t300\t2'].join('\n'), 1);
      await saved(page);
      await projectId(page);
      await openCutListAction(page, 'cabinet-open');
      // The dialog does not scroll (DialogContent has no max height): at 390 the split box sits
      // below the fold already on main, so the phone smoke opens the dialog only (mobile pass).
      if (vp.width > 600) {
        await page.getByTestId('cabinet-split').click();
        await expect(page.getByTestId('cabinet-split-target')).toBeVisible();
        await expect(page.getByTestId('cabinet-add')).toBeInViewport();
      } else {
        await expect(page.getByTestId('cabinet-dialog')).toBeVisible();
      }
      await axeClean(page);
      expect(await noHScroll(page)).toBe(true);
      await shot('cabinet');
    });
  }
}
