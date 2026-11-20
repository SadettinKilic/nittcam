import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { goStep, openNewProject, pasteAndNest, saved, watchConsole } from './wizard-helpers';

// T176: DXF / PDF / label downloads are stored as export records and listed in the history with
// their type; the NC gate is unchanged; the two columns keep the history in view at 1440 × 900.
const d = tr.wizard.documents;
const e = tr.wizard.export;

test('documents are stored and listed by type; history in view at 1440', async ({ page }) => {
  test.setTimeout(120_000);
  const problems = watchConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page);
  await saved(page);
  await goStep(page, 'export');
  const box = page.getByTestId('export-documents');
  await expect(box.getByText(d.hint)).toBeVisible();

  // The history card is in the first screen (CTO #4).
  const historyBox = page.getByTestId('export-history');
  await expect(historyBox).toBeInViewport();

  const rows = page.getByTestId('export-history-row');
  const downloads: string[] = [];
  for (const type of ['dxf-dizilim', 'dxf-parcalar', 'pdf-a4'] as const) {
    const wait = page.waitForEvent('download');
    await box.getByTestId(`export-doc-${type}`).click();
    downloads.push((await wait).suggestedFilename());
  }
  expect(downloads[0]).toMatch(/-r\d+-dizilim\.dxf$/);
  expect(downloads[1]).toMatch(/-r\d+-parcalar\.dxf$/);
  expect(downloads[2]).toMatch(/-r\d+-a4\.pdf$/);
  await expect(rows).toHaveCount(3);
  await expect(page.getByTestId('export-history-kind')).toHaveText([
    e.kinds['pdf-a4'],
    e.kinds['dxf-parcalar'],
    e.kinds['dxf-dizilim'],
  ]);

  // The same document again is the same record (no new history row).
  const again = page.waitForEvent('download');
  await box.getByTestId('export-doc-dxf-dizilim').click();
  await again;
  await expect(rows).toHaveCount(3);

  // The NC download stays behind its checks (the footer button is still gated).
  await expect(page.getByTestId('export-download')).toBeDisabled();
  expect(problems).toEqual([]);
});
