import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { goStep, openNewProject, pasteAndNest, saved, watchConsole } from './wizard-helpers';

// T179: taslak → üretildi after a stored NC export → tamamlandı by hand (and back); re-export from
// the history regenerates the same record (same bytes), with the acceptance asked again for
// unverified NC files.
const w = tr.wizard.export;
const s = tr.wizard.projectStatus;
const names = tr.projects.status;

test('status flow and re-export from history', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watchConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page);
  await saved(page);
  await goStep(page, 'export');

  const badge = page.getByTestId('project-status-badge');
  await expect(badge).toHaveText(names.draft, { timeout: 30_000 });
  await expect(page.getByTestId('project-status')).toContainText(s.hintDraft);
  await expect(page.getByTestId('export-status')).toHaveAttribute('data-ok', 'true', {
    timeout: 30_000,
  });
  await page.getByTestId('export-check-origin').check();
  await page.getByTestId('export-check-tool').check();
  await page.getByTestId('export-check-aircut').check();
  await page.getByTestId('export-accept').check();
  await page.getByTestId('export-download').click();
  await expect(page.getByTestId('export-ready')).toBeVisible();
  await expect(badge).toHaveText(names.produced);

  // Manual: tamamlandı and back.
  await page.getByTestId('project-status-complete').click();
  await expect(badge).toHaveText(names.completed);
  await page.getByTestId('project-status-undo').click();
  await expect(badge).toHaveText(names.produced);

  // Re-export the NC row: checklist and acceptance asked again, then the same record (no new row).
  const rows = page.getByTestId('export-history-row');
  await expect(rows).toHaveCount(1);
  const hash = await rows.first().getAttribute('data-hash');
  await rows.first().getByTestId('export-reexport').click();
  await expect(page.getByTestId('export-reexport-accept')).toBeVisible();
  // D-071: the same checklist as the export step, then the acceptance; confirm is gated.
  const confirm = page.getByTestId('export-reexport-confirm');
  await expect(page.getByTestId('reexport-checklist')).toBeVisible();
  await expect(confirm).toBeDisabled();
  await page.getByTestId('reexport-check-origin').check();
  await page.getByTestId('reexport-check-tool').check();
  await expect(confirm).toBeDisabled();
  await page.getByTestId('reexport-check-aircut').check();
  await expect(confirm).toBeDisabled();
  await page.getByTestId('reexport-accept').check();
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(page.getByText(w.reexportSame)).toBeVisible();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute('data-hash', hash ?? 'x');
  await expect(page.getByTestId('export-state-changed')).toHaveCount(0);
  expect(problems).toEqual([]);
});
