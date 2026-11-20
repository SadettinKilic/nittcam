import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { goStep, openNewProject, pasteAndNest, saved } from './wizard-helpers';

// B32 (T172–T174): the project PDF and the label sheet, generated on the server from the saved
// revision, reachable from the export step.
const d = tr.wizard.documents;

async function toExport(page: Page) {
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page);
  await saved(page);
  await goStep(page, 'export');
  await expect(page.getByTestId('export-documents')).toBeVisible();
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

test('T172: PDF links open the saved revision as a PDF with stable bytes', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await toExport(page);
  const box = page.getByTestId('export-documents');
  await expect(box.getByText(d.hint)).toBeVisible();
  const a4 = box.getByTestId('export-pdf-a4');
  await expect(a4).toHaveText(d.a4);
  await expect(a4).toHaveAttribute('target', '_blank');
  const href = await a4.getAttribute('href');
  expect(href).toMatch(/\/api\/projects\/[0-9a-f-]{36}\/pdf\?revision=\d+&paper=a4$/);

  const first = await page.request.get(href ?? '');
  expect(first.status()).toBe(200);
  expect(first.headers()['content-type']).toBe('application/pdf');
  const bytes = await first.body();
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  const second = await page.request.get(href ?? '');
  expect(sha(await second.body())).toBe(sha(bytes));

  const a3 = await page.request.get(
    (await box.getByTestId('export-pdf-a3').getAttribute('href')) as string,
  );
  expect(a3.status()).toBe(200);
});
