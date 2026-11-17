import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  goStep,
  openNewProject,
  pasteAndNest,
  projectId,
  saved,
  watchConsole,
} from './wizard-helpers';

/**
 * T021: NC export (spec §6.6, §7.2 rules 9–10, §8.2). The server regenerates the file from the
 * saved revision; the download needs the checklist and, on the unverified example profile, the
 * acceptance. The same input gives the same file.
 */
const w = tr.wizard.export;

test('export: checklist + acceptance → stored file with the header; same input → same file', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = watchConsole(page);
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page);
  await saved(page);
  const id = await projectId(page);
  await goStep(page, 'export');

  const status = page.getByTestId('export-status');
  await expect(status).toHaveAttribute('data-ok', 'true', { timeout: 30_000 });
  await expect(page.getByTestId('export-files')).toBeVisible();
  await expect(page.getByTestId('export-history')).toContainText(w.historyEmpty);

  const download = page.getByTestId('export-download');
  await expect(download).toBeDisabled();
  await expect(page.getByTestId('export-hint')).toHaveText(w.needChecks);
  await page.getByTestId('export-check-origin').check();
  await page.getByTestId('export-check-tool').check();
  await page.getByTestId('export-check-aircut').check();
  // The seeded example profile is not verified: the acceptance step is required (rule 10).
  await expect(page.getByTestId('export-unverified')).toBeVisible();
  await expect(download).toBeDisabled();
  await expect(page.getByTestId('export-hint')).toHaveText(w.needAccept);
  await page.getByTestId('export-accept').check();
  await expect(download).toBeEnabled();

  const files = await page.getByTestId('export-files').locator('li').count();
  // One file downloads at once; several are listed as links (one per sheet).
  const first =
    files === 1
      ? (await Promise.all([page.waitForEvent('download'), download.click()]))[0]
      : await (async () => {
          await download.click();
          const link = page.getByTestId('export-ready').getByRole('link').first();
          return (await Promise.all([page.waitForEvent('download'), link.click()]))[0];
        })();
  await expect(page.getByTestId('export-ready')).toBeVisible();
  await expect(page.getByTestId('export-history-row')).toHaveCount(1);

  const path = await first.path();
  const bytes = await readFile(path);
  const text = bytes.toString('utf8');
  expect(text.split('\n')[0]).toContain('DOGRULANMADI, once air cut');
  expect(text).toContain('(PROJE: ');
  expect(text).toMatch(/\(REV[İI]ZYON: \d+\)/);
  const hash = createHash('sha256').update(bytes).digest('hex');

  // Same revision again → the same stored export, the same bytes (idempotent, deterministic).
  const revision = Number(await page.getByTestId('save-status').getAttribute('data-revision'));
  const again = await page.request.post(`/api/projects/${id}/export`, {
    data: { revision, acceptUnverified: true },
  });
  expect(again.status()).toBe(200);
  const record = (await again.json()) as {
    created: boolean;
    files: { name: string; hash: string }[];
  };
  expect(record.created).toBe(false);
  expect(record.files).toHaveLength(files);
  expect(record.files.map((f) => f.hash)).toContain(hash);

  // Without the acceptance the server refuses (428), even for a known export.
  const refused = await page.request.post(`/api/projects/${id}/export`, { data: { revision } });
  expect(refused.status()).toBe(428);
  expect(problems).toEqual([]);
});
