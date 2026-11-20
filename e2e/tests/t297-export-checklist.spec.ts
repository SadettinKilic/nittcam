import { expect, test } from '@playwright/test';
import { openNewProject, pasteAndNest, projectId, saved, watchConsole } from './wizard-helpers';

/**
 * T297 (D-072): the main NC export needs the pre-export checklist confirmation on the server too,
 * like the re-export (D-071). Without `checklistConfirmed: true` → 428 `checklist_required` with
 * the checklist data, nothing stored; a non-boolean → 400; with it (and the acceptance) → stored.
 */
test('main NC export: 428 checklist_required until the checklist is confirmed', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const problems = watchConsole(page);
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page);
  await saved(page);
  const id = await projectId(page);
  const { revision } = (await (await request.get(`/api/projects/${id}`)).json()) as {
    revision: number;
  };
  const api = `/api/projects/${id}/export`;
  const history = async () =>
    ((await (await request.get(`/api/projects/${id}/exports`)).json()) as unknown[]).length;

  const noList = await request.post(api, { data: { revision, acceptUnverified: true } });
  expect(noList.status()).toBe(428);
  const body = (await noList.json()) as { error: string; checklist: unknown };
  expect(body.error).toBe('checklist_required');
  expect(body.checklist).not.toBeNull();
  const falseList = await request.post(api, {
    data: { revision, acceptUnverified: true, checklistConfirmed: false },
  });
  expect(falseList.status()).toBe(428);
  const stringList = await request.post(api, {
    data: { revision, acceptUnverified: true, checklistConfirmed: 'true' },
  });
  expect(stringList.status()).toBe(400);
  expect(await history()).toBe(0);

  // The checklist alone is not the acceptance of unverified files (§7.2 rule 10).
  const noAccept = await request.post(api, { data: { revision, checklistConfirmed: true } });
  expect(noAccept.status()).toBe(428);
  expect(((await noAccept.json()) as { error: string }).error).toBe('acceptance_required');

  const ok = await request.post(api, {
    data: { revision, acceptUnverified: true, checklistConfirmed: true },
  });
  expect(ok.status()).toBe(201);
  expect(await history()).toBe(1);
  expect(problems).toEqual([]);
});
