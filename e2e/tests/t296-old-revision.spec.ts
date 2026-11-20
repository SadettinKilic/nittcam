import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  openNewProject,
  pasteAndNest,
  projectId,
  saved,
  watchConsole,
} from './wizard-helpers';

/**
 * T296: a file made from an older revision than the project is marked "eski revizyon" in the
 * Projeler list and in the export history, with one click to the current-revision control.
 * T295: every name follows `<project>_r<revision>_<kind>.<ext>`.
 */
const w = tr.wizard.export;
const p = tr.projects;

interface Rec {
  exportId: string;
  kind: string;
  revision: number;
  files: { name: string }[];
}

test('old-revision badge in Projeler and history, regenerate goes to the current control', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const problems = watchConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page);
  await saved(page);
  const id = await projectId(page);
  const detail = (await (await request.get(`/api/projects/${id}`)).json()) as {
    revision: number;
    project: unknown;
  };
  const r1 = detail.revision;

  // NC (checklist confirmed, D-072) and a DXF of revision r1.
  const nc = await request.post(`/api/projects/${id}/export`, {
    data: { revision: r1, acceptUnverified: true, checklistConfirmed: true },
  });
  expect(nc.status()).toBe(201);
  const ncRec = (await nc.json()) as Rec;
  for (const f of ncRec.files) expect(f.name).toMatch(new RegExp(`_r${r1}_S\\d+(_|\\.)`));
  const dxf = await request.post(`/api/projects/${id}/documents`, {
    data: { revision: r1, type: 'dxf-dizilim' },
  });
  expect(dxf.ok()).toBe(true);
  expect(((await dxf.json()) as Rec).files[0]?.name).toMatch(new RegExp(`_r${r1}_dizilim\\.dxf$`));

  // Projeler: the newest file is of the current revision → no badge.
  await page.goto('/projeler');
  const row = page.locator(`[data-testid="project-row"][data-id="${id}"]`);
  await expect(row.getByTestId('project-last-export')).toBeVisible();
  await expect(row.getByTestId('project-export-old')).toHaveCount(0);

  // A new saved revision: the last NC file is now old.
  const put = await request.put(`/api/projects/${id}`, {
    data: { baseRevision: r1, project: detail.project },
  });
  expect(put.ok()).toBe(true);
  await page.reload();
  await expect(row.getByTestId('project-export-old')).toHaveText(p.oldRevision);
  // The old file can still be downloaded; the link opens the export step of the project.
  await expect(row.getByRole('link', { name: new RegExp(`_r${r1}_S1`) })).toBeVisible();
  await row.getByTestId('project-export-regenerate').click();
  await expect(page).toHaveURL(new RegExp(`/projeler/${id}\\?adim=export`));

  // History: both rows are old; "Güncel revizyonla üret" focuses the current control.
  await expect(page.getByTestId('export-history-row')).toHaveCount(2, { timeout: 30_000 });
  await expect(page.getByTestId('export-history-old')).toHaveCount(2);
  const dxfRow = page.getByTestId('export-history-row').filter({ hasText: 'dizilim' });
  await dxfRow.getByTestId('export-history-current').click();
  await expect(page.getByTestId('export-doc-dxf-dizilim')).toBeFocused();
  const ncRow = page.getByTestId('export-history-row').filter({ hasText: '_S1' });
  await expect(page.getByTestId('export-checklist')).toBeVisible({ timeout: 30_000 });
  await ncRow.getByTestId('export-history-current').click();
  await expect(page.getByTestId('export-checklist').locator(':focus')).toHaveCount(1);
  expect(w.historyOld).toBe('eski revizyon');
  expect(problems).toEqual([]);
});
