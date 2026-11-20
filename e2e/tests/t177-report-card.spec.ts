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

// T177: the project report card on the export step shows the server's report summary (the same
// numbers the PDF report prints).
const p = tr.pdf;

test('report card shows the saved revision report', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watchConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page);
  await saved(page);
  const id = await projectId(page);
  await goStep(page, 'export');
  const card = page.getByTestId('report-card');
  await expect(card.getByTestId('report-tiles')).toBeVisible({ timeout: 30_000 });
  await expect(card.getByTestId('report-sheets')).toContainText(p.sheets);

  const rev = (await page.getByTestId('export-revision').textContent())?.match(/\d+/)?.[0];
  const res = await page.request.get(`/api/projects/${id}/report?revision=${rev}`);
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { sheetCount: number; totalPieces: number };
  await expect(card.getByTestId('report-sheets').locator('dd')).toHaveText(String(body.sheetCount));
  await expect(card.getByTestId('report-pieces').locator('dd')).toHaveText(
    String(body.totalPieces),
  );
  await expect(card.getByTestId('report-waste').locator('dd')).toHaveText(/^%\d+,\d$/);
  expect(problems).toEqual([]);
});
