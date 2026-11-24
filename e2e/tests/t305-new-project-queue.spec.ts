import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  fill,
  goStep,
  openNewProject,
  paste,
  projectId,
  saved,
  watchConsole,
} from './wizard-helpers';

/**
 * T305 (D-094): the unsent queue of a project that is not created yet belongs to that one draft.
 * Leaving a new project before its first save came back left its queue under a shared key, and
 * the next "Yeni proje" replayed the first project's parts (and reused its id, so its saves went
 * into the first project). These specs never wait for the first save before leaving.
 */

const t = tr.cutList;

async function unsentKeys(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Object.keys(localStorage).filter((k) => k.startsWith('nittcam.unsent.')),
  );
}

/** The menu opens step 1; the parts count lives on step 2. */
async function goStepIfNeeded(page: Page) {
  if ((await page.getByTestId('wizard-step-title').getAttribute('data-step')) !== 'parcalar') {
    await goStep(page, 'parcalar');
  }
}

async function partNames(page: Page, id: string): Promise<string[]> {
  const res = await page.request.get(`/api/projects/${id}`);
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { project: { parts: { name: string }[] } };
  return body.project.parts.map((p) => p.name).sort();
}

test.describe('T305 new project unsent queue', () => {
  test('leaving a new project before its first save: the next new project starts empty', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const problems = watchConsole(page);
    // The create reaches the server, but its answer never comes back (the page is left first).
    let created = 0;
    await page.route('**/api/projects', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      created += 1;
      await route.fetch();
      await route.abort('internetdisconnected');
    });
    await openNewProject(page, 'parcalar');
    await paste(page, 'Ad\tEn\tBoy\tAdet\nBirinci\t600\t500\t2', 1);
    await expect.poll(() => created, { timeout: 15_000 }).toBeGreaterThan(0);
    await expect.poll(() => unsentKeys(page)).not.toEqual([]);
    await page.unroute('**/api/projects');

    // No waiting: straight to the list and a second new project.
    await page.goto('/projeler');
    await openNewProject(page, 'parcalar');
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(t.count, { rows: 0, pieces: 0 }),
    );
    await paste(page, 'Ad\tEn\tBoy\tAdet\nIkinci\t300\t300\t1', 1);
    await saved(page);
    const second = await projectId(page);
    expect(await partNames(page, second)).toEqual(['Ikinci']);

    // The first project kept its own part (its create went through) and is a different project.
    const list = (await (await page.request.get('/api/projects')).json()) as { id: string }[];
    const others = list.map((p) => p.id).filter((id) => id !== second);
    const names = await Promise.all(others.slice(0, 5).map((id) => partNames(page, id)));
    expect(names).toContainEqual(['Birinci']);
    // Only the answer this spec cut off on purpose.
    expect(problems.filter((p) => !p.includes('ERR_INTERNET_DISCONNECTED'))).toEqual([]);
  });

  test('"+ Yeni proje" in the menu while a draft is not saved yet opens an empty project', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.route('**/api/projects', (route) =>
      route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.continue(),
    );
    await openNewProject(page, 'parcalar');
    await expect(page).toHaveURL(/taslak=[0-9a-f-]{36}/);
    const draft = new URL(page.url()).searchParams.get('taslak');
    await paste(page, 'Ad\tEn\tBoy\tAdet\nBirinci\t600\t500\t2', 1);
    await page.getByTestId('nav-new-project').click();
    // A fresh draft: the address names another draft id.
    await expect
      .poll(() => new URL(page.url()).searchParams.get('taslak') ?? '')
      .toMatch(/^[0-9a-f-]{36}$/);
    await expect.poll(() => new URL(page.url()).searchParams.get('taslak')).not.toBe(draft);
    await page.unroute('**/api/projects');
    await page.getByTestId('wizard-step-title').waitFor();
    await goStepIfNeeded(page);
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(t.count, { rows: 0, pieces: 0 }),
    );
  });

  test('a reload of a new project before its first save still restores its own edit', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.route('**/api/projects', (route) =>
      route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.continue(),
    );
    await openNewProject(page, 'parcalar');
    await paste(page, 'Ad\tEn\tBoy\tAdet\nTaslak\t400\t300\t1', 1);
    await expect.poll(() => unsentKeys(page)).not.toEqual([]);
    await page.unroute('**/api/projects');
    await page.reload();
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(t.count, { rows: 1, pieces: 1 }),
    );
    await saved(page);
    expect(await partNames(page, await projectId(page))).toEqual(['Taslak']);
  });
});
