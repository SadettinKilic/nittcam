import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  fill,
  openNewProject,
  pasteAndNest,
  projectId,
  saved,
  watchConsole,
} from './wizard-helpers';

/**
 * T303 (CTO #12 on T296): a project saved again after its NC export does not stay a silent
 * "Üretildi": Projeler shows "değişti" next to the status, the export step's status card says
 * "Üretildikten sonra değişti (Rev. 2; son NC Rev. 1)" with one click to the NC checklist.
 */
const s = tr.wizard.projectStatus;
const p = tr.projects;

test('changed after üretildi: Projeler badge and status card, regenerate focuses the checklist', async ({
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
  const nc = await request.post(`/api/projects/${id}/export`, {
    data: { revision: r1, acceptUnverified: true, checklistConfirmed: true },
  });
  expect(nc.status()).toBe(201);

  // Current NC: no "değişti".
  await page.goto('/projeler');
  const row = page.locator(`[data-testid="project-row"][data-id="${id}"]`);
  await expect(row.getByTestId('project-status')).toHaveText(p.status.produced);
  await expect(row.getByTestId('project-status-changed')).toHaveCount(0);

  const put = await request.put(`/api/projects/${id}`, {
    data: { baseRevision: r1, project: detail.project },
  });
  expect(put.ok()).toBe(true);
  const text = fill(s.changed, { current: r1 + 1, nc: r1 });
  await page.reload();
  const badge = row.getByTestId('project-status-changed');
  await expect(badge).toContainText(p.changed);
  await expect(badge).toHaveAttribute('title', fill(p.changedTitle, { current: r1 + 1, nc: r1 }));

  await page.goto(`/projeler/${id}?adim=export`);
  const card = page.getByTestId('project-status');
  await expect(card.getByTestId('project-status-changed')).toContainText(text, { timeout: 30_000 });
  await expect(page.getByTestId('export-checklist')).toBeVisible({ timeout: 30_000 });
  await card.getByTestId('project-status-regenerate').click();
  await expect(page.getByTestId('export-checklist').locator(':focus')).toHaveCount(1);
  expect(problems).toEqual([]);
});
