import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  KITCHEN,
  chooseMachine,
  goStep,
  openNewProject,
  pasteAndNest,
  projectId,
  saved,
  wizardReady,
} from './wizard-helpers';

// B13a tester (T269): the reverse direction (step-down lowered) together with a tool diameter
// change in the new version. Until "Son sürüme geç" step 1's "Kesim ayarı", Dizilim's "Takım Ø"
// chip, the Simülasyon summary (passes, time) and its first lines stay those of the project's
// version and equal the export; the button on Dışa aktar is one undo step; `?profil=son` moves
// the project to the latest version.

type Profile = Record<string, unknown> & {
  identity: Record<string, unknown>;
  tools: { number: number; diameter: number }[];
  materials: { material: string; thickness: number; stepDown: number; tool: number }[];
};

async function newMachine(request: APIRequestContext, name: string) {
  const list = (await (await request.get('/api/machines')).json()) as { id: string }[];
  const first = list[0];
  if (!first) throw new Error('no seeded machine');
  const seeded = (await (await request.get(`/api/machines/${first.id}`)).json()) as {
    profile: Profile;
  };
  const profile = structuredClone(seeded.profile);
  profile.example = false;
  profile.identity = { ...profile.identity, name };
  const res = await request.post('/api/machines', { data: { profile } });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string; version: number; profile: Profile };
}

async function headLines(page: Page): Promise<string[]> {
  return page
    .getByTestId('gcode-panel')
    .locator('button[data-file="0"]')
    .evaluateAll((els) =>
      els
        .map((e) => ({ n: Number(e.getAttribute('data-line')), t: e.getAttribute('data-text') }))
        .sort((a, b) => a.n - b.n)
        .filter((r) => r.n <= 12)
        .map((r) => r.t ?? ''),
    );
}

async function exported(request: APIRequestContext, id: string, revision: number) {
  const res = await request.post(`/api/projects/${id}/export`, {
    data: { revision, acceptUnverified: true },
  });
  expect(res.status()).toBeLessThan(300);
  const body = (await res.json()) as { profileVersion: number; files: { downloadUrl: string }[] };
  const url = body.files[0]?.downloadUrl;
  if (!url) throw new Error('no exported file');
  const lines = (await (await request.get(url)).text()).split(/\r?\n/);
  return { version: body.profileVersion, head: lines.slice(0, 12) };
}

/** Simülasyon: summary text (passes, time, …) and the first 12 lines, once checked and saved. */
async function simState(page: Page) {
  await expect(page.getByTestId('sim-check-status')).toBeVisible({ timeout: 30_000 });
  await saved(page);
  await expect.poll(async () => (await headLines(page)).length).toBeGreaterThan(5);
  return {
    summary: (await page.getByTestId('sim-summary-list').innerText()).trim(),
    head: await headLines(page),
    revision: Number(await page.getByTestId('save-status').getAttribute('data-revision')),
  };
}

test('B13a tester T269: step-down lowered + tool Ø changed: all steps keep the project version until "Son sürüme geç"', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const name = `B13a rev ${Date.now()}`;
  const machine = await newMachine(request, name);
  const old = machine.version;

  await openNewProject(page, 'makine');
  await chooseMachine(page, name);
  const paramsOld = (await page.getByTestId('cutting-params').innerText()).trim();
  await pasteAndNest(page, KITCHEN, 5, 'makine');
  await saved(page);
  const id = await projectId(page);
  const chipsOld = (await page.getByTestId('nesting-chips').innerText()).trim();
  await goStep(page, 'simulasyon');
  const simOld = await simState(page);

  // New version: MDF 18 step-down lowered (more passes) and its tool 2 mm thicker.
  const next = structuredClone(machine.profile);
  const set = next.materials.find((m) => m.material === 'mdf' && m.thickness === 18);
  if (!set) throw new Error('no MDF 18 set');
  set.stepDown = Math.max(1, set.stepDown - 2);
  const tool = next.tools.find((t) => t.number === set.tool);
  if (!tool) throw new Error('no tool');
  tool.diameter += 2;
  const put = await request.put(`/api/machines/${machine.id}`, { data: { profile: next } });
  expect(put.status()).toBe(200);
  const latest = ((await put.json()) as { version: number }).version;
  expect(latest).toBeGreaterThan(old);

  // Reopen: step 1 sentence and machine row are the project's version.
  await page.goto(`/projeler/${id}?adim=makine`);
  await wizardReady(page, 'makine');
  await expect(page.getByTestId('wizard-machine')).toContainText(`sürüm ${old}`);
  await expect(page.getByTestId('profile-version-notice')).toBeVisible();
  await expect(page.getByTestId('cutting-params')).toHaveText(paramsOld);
  await page.screenshot({ path: '__screenshots__/b13a-t269-makine-1440.png' });

  await goStep(page, 'dizilim');
  await expect(page.getByTestId('nesting-chips')).toHaveText(chipsOld);

  await goStep(page, 'simulasyon');
  const simPinned = await simState(page);
  expect(simPinned.summary).toBe(simOld.summary);
  expect(simPinned.head.filter((l) => !/REV[İI]ZYON|TAR[İI]H|DATE/i.test(l))).toEqual(
    simOld.head.filter((l) => !/REV[İI]ZYON|TAR[İI]H|DATE/i.test(l)),
  );
  const file = await exported(request, id, simPinned.revision);
  expect(file.version).toBe(old);
  expect(simPinned.head).toEqual(file.head);
  await page.screenshot({ path: '__screenshots__/b13a-t269-sim-1440.png' });

  // "Son sürüme geç" on Dışa aktar.
  await goStep(page, 'export');
  await expect(page.getByTestId('profile-version-notice')).toBeVisible();
  await page.screenshot({ path: '__screenshots__/b13a-t269-export-1440.png' });
  await page.getByTestId('profile-use-latest').click();
  await expect(page.getByTestId('profile-version-notice')).toBeHidden();

  await goStep(page, 'simulasyon');
  await expect(page.getByTestId('sim-machine-name')).toContainText(`sürüm ${latest}`);
  const simNew = await simState(page);
  expect(simNew.summary).not.toBe(simOld.summary);
  const fileNew = await exported(request, id, simNew.revision);
  expect(fileNew.version).toBe(latest);
  expect(simNew.head).toEqual(fileNew.head);

  await goStep(page, 'makine');
  await expect(page.getByTestId('wizard-machine')).toContainText(`sürüm ${latest}`);
  await expect(page.getByTestId('cutting-params')).not.toHaveText(paramsOld);
  await goStep(page, 'dizilim');
  await expect(page.getByTestId('nesting-chips')).not.toHaveText(chipsOld);

  // One undo step back to the project's old version, the box returns.
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await goStep(page, 'makine');
  await expect(page.getByTestId('wizard-machine')).toContainText(`sürüm ${old}`);
  await expect(page.getByTestId('profile-version-notice')).toBeVisible();
  await expect(page.getByTestId('cutting-params')).toHaveText(paramsOld);
});

test('B13a tester T269: `?profil=son` moves the project to the latest version', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const name = `B13a son ${Date.now()}`;
  const machine = await newMachine(request, name);
  await openNewProject(page, 'makine');
  await chooseMachine(page, name);
  await pasteAndNest(page, KITCHEN, 5, 'makine');
  await saved(page);
  const id = await projectId(page);

  const next = structuredClone(machine.profile);
  const set = next.materials.find((m) => m.material === 'mdf' && m.thickness === 18);
  if (!set) throw new Error('no MDF 18 set');
  set.stepDown += 3;
  const put = await request.put(`/api/machines/${machine.id}`, { data: { profile: next } });
  const latest = ((await put.json()) as { version: number }).version;

  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto(`/projeler/${id}?adim=makine&profil=son`);
  await wizardReady(page, 'makine');
  await expect(page.getByTestId('wizard-machine')).toContainText(`sürüm ${latest}`);
  await expect(page.getByTestId('profile-version-notice')).toBeHidden();
  await expect(page).not.toHaveURL(/profil=son/);
  await saved(page);
  await goStep(page, 'simulasyon');
  await expect(page.getByTestId('sim-machine-name')).toContainText(`sürüm ${latest}`);
  await expect(page.getByTestId('profile-version-notice')).toBeHidden();
  await page.screenshot({ path: '__screenshots__/b13a-t269-sim-1024.png' });
});
