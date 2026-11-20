import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  chooseMachine,
  fill,
  goStep,
  openNewProject,
  paste,
  pickOption,
  projectId,
  saved,
  wizardReady,
} from './wizard-helpers';

/**
 * T305 tester (D-094): try to get one project's parts into another. Each test uses its own part
 * names; at the end no project may hold names of two different drafts.
 */
const t = tr.cutList;
const HEAD = 'Ad\tEn\tBoy\tAdet\n';

const blockCreate = (page: Page) =>
  page.route('**/api/projects', (route) =>
    route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.continue(),
  );

async function step2(page: Page) {
  if ((await page.getByTestId('wizard-step-title').getAttribute('data-step')) !== 'parcalar') {
    await goStep(page, 'parcalar');
  }
}

async function empty(page: Page, fromMenu = false) {
  // The menu opens a new project on step 1; wait for it so the old draft's step 2 is gone.
  if (fromMenu) await wizardReady(page, 'makine');
  else await page.getByTestId('wizard-step-title').waitFor();
  await step2(page);
  await expect(page.getByTestId('cut-list-count')).toHaveText(
    fill(t.count, { rows: 0, pieces: 0 }),
  );
}

async function partNames(request: APIRequestContext, id: string): Promise<string[]> {
  const res = await request.get(`/api/projects/${id}`);
  if (!res.ok()) return [];
  const body = (await res.json()) as { project: { parts: { name: string }[] } };
  return body.project.parts.map((p) => p.name).sort();
}

/** No recent project mixes the given names (each project holds at most one of them). */
async function noMix(request: APIRequestContext, names: string[]) {
  const list = (await (await request.get('/api/projects')).json()) as { id: string }[];
  const found: string[][] = [];
  for (const p of list.slice(0, 25)) {
    const mine = (await partNames(request, p.id)).filter((n) => names.includes(n));
    if (mine.length > 0) found.push(mine);
  }
  for (const f of found) expect(new Set(f).size, `mixed: ${f.join(', ')}`).toBe(1);
  return found;
}

async function gridText(page: Page): Promise<string> {
  return page.getByTestId('cut-list-grid').evaluate((el) => {
    const vals = [...el.querySelectorAll('input')].map((i) => (i as HTMLInputElement).value);
    return `${el.textContent ?? ''} ${vals.join(' ')}`;
  });
}

const tag = () => String(Date.now()).slice(-6);

test.describe('T305 tester', () => {
  test.setTimeout(150_000);

  test('leaving via "Ana sayfa" before the first save: the next new project starts empty', async ({
    page,
    request,
  }) => {
    const a = `Ev${tag()}`;
    const b = `Yeni${tag()}`;
    await blockCreate(page);
    await openNewProject(page, 'parcalar');
    await paste(page, `${HEAD}${a}\t600\t500\t2`, 1);
    await page.unroute('**/api/projects');
    await page
      .getByTestId('shell-sidebar')
      .getByRole('link', { name: 'Ana sayfa', exact: true })
      .click();
    await expect(page).toHaveURL(/\/$/);
    await page.getByTestId('nav-new-project').click();
    await empty(page, true);
    await paste(page, `${HEAD}${b}\t300\t300\t1`, 1);
    await saved(page);
    expect(await partNames(request, await projectId(page))).toEqual([b]);
    await noMix(request, [a, b]);
  });

  test('offline draft: "+ Yeni proje" offline, back online: Geri restores it, the next is empty', async ({
    page,
    context,
    request,
  }) => {
    const a = `Off${tag()}`;
    const b = `On${tag()}`;
    await openNewProject(page, 'parcalar');
    await context.setOffline(true);
    await paste(page, `${HEAD}${a}	600	500	1`, 1);
    await page.waitForTimeout(1500);
    // Offline, the menu link is a full page load: the browser shows its own error page.
    await page.getByTestId('nav-new-project').click();
    await page.waitForTimeout(1500);
    await context.setOffline(false);
    // Back to the draft: its own unsent part comes back (and only it), then it saves.
    await page.goBack();
    await wizardReady(page, 'parcalar');
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(t.count, { rows: 1, pieces: 1 }),
    );
    await saved(page);
    expect(await partNames(request, await projectId(page))).toEqual([a]);
    await page.getByTestId('nav-new-project').click();
    await empty(page, true);
    await paste(page, `${HEAD}${b}	300	300	1`, 1);
    await saved(page);
    expect(await partNames(request, await projectId(page))).toEqual([b]);
    await noMix(request, [a, b]);
  });

  test('two tabs with unsaved drafts each save only their own parts', async ({
    page,
    context,
    request,
  }) => {
    const a = `TabA${tag()}`;
    const b = `TabB${tag()}`;
    await blockCreate(page);
    await openNewProject(page, 'parcalar');
    await paste(page, `${HEAD}${a}\t600\t500\t1`, 1);
    const page2 = await context.newPage();
    await openNewProject(page2, 'parcalar');
    await empty(page2);
    await paste(page2, `${HEAD}${b}\t300\t300\t1`, 1);
    await saved(page2);
    const idB = await projectId(page2);
    expect(await partNames(request, idB)).toEqual([b]);
    // Tab A comes back online and saves its own draft.
    await page.unroute('**/api/projects');
    await paste(page, `${HEAD}${a}x\t100\t100\t1`, 1);
    await saved(page);
    const idA = await projectId(page);
    expect(idA).not.toBe(idB);
    expect(await partNames(request, idA)).toEqual([a, `${a}x`].sort());
    expect(await partNames(request, idB)).toEqual([b]);
    await page2.close();
  });

  test('a copied ?taslak= address in a new tab opens an empty draft of its own', async ({
    page,
    context,
    request,
  }) => {
    const a = `Kop${tag()}`;
    const c = `Yeni${tag()}`;
    await blockCreate(page);
    await openNewProject(page, 'parcalar');
    await paste(page, `${HEAD}${a}\t600\t500\t1`, 1);
    await expect(page).toHaveURL(/taslak=[0-9a-f-]{36}/);
    const copied = page.url();
    const draftA = new URL(copied).searchParams.get('taslak');
    const page2 = await context.newPage();
    await page2.goto(copied);
    await wizardReady(page2, 'parcalar');
    await empty(page2);
    await expect.poll(() => new URL(page2.url()).searchParams.get('taslak')).not.toBe(draftA);
    await paste(page2, `${HEAD}${c}\t300\t300\t1`, 1);
    await saved(page2);
    expect(await partNames(request, await projectId(page2))).toEqual([c]);
    await page.unroute('**/api/projects');
    await page.reload();
    await wizardReady(page, 'parcalar');
    await saved(page);
    expect(await partNames(request, await projectId(page))).toEqual([a]);
    await noMix(request, [a, c]);
    await page2.close();
  });

  test('Back / Forward between two unsaved drafts never moves parts', async ({ page, request }) => {
    const a = `Ger${tag()}`;
    const b = `Ile${tag()}`;
    await blockCreate(page);
    await openNewProject(page, 'parcalar');
    await paste(page, `${HEAD}${a}\t600\t500\t1`, 1);
    await page.getByTestId('nav-new-project').click();
    await empty(page, true);
    await paste(page, `${HEAD}${b}\t300\t300\t1`, 1);
    const draftB = new URL(page.url()).searchParams.get('taslak');
    for (const dir of ['back', 'back', 'forward', 'forward'] as const) {
      if (dir === 'back') await page.goBack();
      else await page.goForward();
      await page.waitForTimeout(800);
      const title = page.getByTestId('wizard-step-title');
      if ((await title.count()) === 0) continue;
      const step = await title.getAttribute('data-step');
      if (step !== 'parcalar') continue;
      // The grid of whichever draft is shown holds at most one of the two names.
      const grid = await gridText(page);
      expect(grid.includes(a) && grid.includes(b), `${dir}: both drafts in one`).toBe(false);
      const draft = new URL(page.url()).searchParams.get('taslak');
      if (draft === draftB) expect(grid.includes(a)).toBe(false);
    }
    await page.unroute('**/api/projects');
    await page.reload();
    await wizardReady(page);
    await step2(page);
    await page.waitForTimeout(3000);
    await noMix(request, [a, b]);
  });

  test('"Kesim ayarı ekle" before the first save comes back to this project; next is empty', async ({
    page,
    request,
  }) => {
    const a = `Ayar${tag()}`;
    const name = `T305 ayar ${Date.now()}`;
    const list = (await (await request.get('/api/machines')).json()) as { id: string }[];
    const seeded = (await (await request.get(`/api/machines/${list[0]?.id}`)).json()) as {
      profile: Record<string, unknown> & { identity: Record<string, unknown> };
    };
    const profile = structuredClone(seeded.profile);
    profile.example = false;
    profile.identity = { ...profile.identity, name };
    expect((await request.post('/api/machines', { data: { profile } })).status()).toBe(201);

    // The create answers late: the click comes before the first save is through.
    await page.route('**/api/projects', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      await new Promise((r) => setTimeout(r, 2500));
      await route.continue();
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'parcalar');
    await paste(page, `${HEAD}${a}\t600\t500\t1`, 1);
    await goStep(page, 'makine');
    await chooseMachine(page, name);
    await pickOption(page.getByTestId('wizard-material'), tr.materials.pvc);
    await page.getByTestId('add-cutting-params').click();
    await expect(page.getByTestId('machine-form')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: tr.machines.form.save, exact: true }).click();
    const done = page.getByTestId('param-fix-saved');
    await expect(done).toBeVisible({ timeout: 30_000 });
    await done.getByTestId('param-fix-return').click();
    await expect(page).toHaveURL(/\/projeler\/[0-9a-f-]{36}\?adim=makine/);
    await wizardReady(page, 'makine');
    const id = await projectId(page);
    expect(await partNames(request, id)).toEqual([a]);
    await page.unroute('**/api/projects');
    await page.getByTestId('nav-new-project').click();
    await empty(page, true);
  });
});
