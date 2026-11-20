import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { openNewProject, pasteAndNest, projectId, saved, toastsSettled } from './wizard-helpers';

/**
 * Tester (B41): T295 names of a Turkish project name are ASCII `<stem>_r<rev>_<kind>.<ext>` for NC,
 * PDF, labels and the zip; T296 badge rows stay inside 390 px and pass axe in both places.
 */

interface Rec {
  exportId: string;
  files: { name: string }[];
}

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

test('Turkish name → ASCII names for every kind; old-revision rows fit 390 px and pass axe', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page);
  const name = `Çekmeceli Gövde Şöğüt ${Math.random().toString(36).slice(2, 6)}`;
  const nameField = page.getByTestId('project-name');
  await nameField.fill(name);
  await nameField.press('Enter');
  await saved(page);
  const id = await projectId(page);
  const detail = (await (await request.get(`/api/projects/${id}`)).json()) as {
    revision: number;
    project: unknown;
  };
  const rev = detail.revision;
  const stem = 'Cekmeceli_Govde_Sogut_';

  const nc = await request.post(`/api/projects/${id}/export`, {
    data: { revision: rev, acceptUnverified: true, checklistConfirmed: true },
  });
  expect(nc.status()).toBe(201);
  const ncRec = (await nc.json()) as Rec;
  for (const f of ncRec.files) {
    expect(f.name).toMatch(/^[A-Za-z0-9_.]+$/);
    // A controller name limit may shorten the project part only.
    expect(f.name.startsWith('Cekmeceli')).toBe(true);
    expect(f.name).toMatch(new RegExp(`_r${rev}_S\\d+`));
  }
  const zip = await request.get(`/api/exports/${ncRec.exportId}/zip`);
  expect(zip.ok()).toBe(true);
  const disp = zip.headers()['content-disposition'] ?? '';
  expect(disp).toContain(`_r${rev}_nc.zip`);
  expect(disp).toContain(stem);

  for (const [type, kind, ext] of [
    ['pdf-a4', 'a4', 'pdf'],
    ['dxf-parcalar', 'parcalar', 'dxf'],
  ] as const) {
    const r = await request.post(`/api/projects/${id}/documents`, {
      data: { revision: rev, type },
    });
    expect(r.ok(), type).toBe(true);
    const file = ((await r.json()) as Rec).files[0]?.name ?? '';
    expect(file).toMatch(new RegExp(`^${stem}[a-z0-9]+_r${rev}_${kind}\\.${ext}$`));
  }

  // New saved revision → the files are old.
  const put = await request.put(`/api/projects/${id}`, {
    data: { baseRevision: rev, project: detail.project },
  });
  expect(put.ok()).toBe(true);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/projeler');
  const row = page.locator(`[data-testid="project-row"][data-id="${id}"]`);
  await expect(row.getByTestId('project-export-old')).toBeVisible({ timeout: 30_000 });
  expect(await noHScroll(page)).toBe(true);
  await axeClean(page);

  await row.getByTestId('project-export-regenerate').click();
  await expect(page).toHaveURL(new RegExp(`/projeler/${id}\\?adim=export`));
  await expect(page.getByTestId('export-history-old').first()).toBeVisible({ timeout: 30_000 });
  expect(await noHScroll(page)).toBe(true);
  await axeClean(page);
});
