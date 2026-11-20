import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { goStep, openNewProject, pasteAndNest, pickOption, saved } from './wizard-helpers';

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

const l = tr.wizard.documents.labels;

test('T174: label sheet: presets, custom grid check, remembered print offset, PDF', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    // A fresh browser: no remembered label settings (set only once, so a reload keeps them).
    if (!sessionStorage.getItem('b32-init')) {
      localStorage.removeItem('nittcam-label-settings');
      sessionStorage.setItem('b32-init', '1');
    }
  });
  await toExport(page);
  const box = page.getByTestId('export-labels');
  // KITCHEN = 8 + 4 + 6 + 8 + 4 = 30 pieces; 3 × 8 = 24 per page.
  await expect(box.getByTestId('labels-count')).toHaveText('30 etiket, 2 sayfa');
  await pickOption(box.getByTestId('labels-preset'), l.presets['a4-2x7']);
  await expect(box.getByTestId('labels-count')).toHaveText('30 etiket, 3 sayfa');

  // Custom grid wider than A4 → error, no link.
  await pickOption(box.getByTestId('labels-preset'), l.presets.custom);
  const cols = box.getByTestId('labels-cols');
  await cols.fill('4');
  await cols.blur();
  await expect(box.getByTestId('labels-invalid')).toHaveText(l.invalid);
  await expect(box.getByTestId('export-labels-open')).toHaveCount(0);
  await cols.fill('2');
  await cols.blur();
  await expect(box.getByTestId('labels-invalid')).toHaveCount(0);

  // Print offset: remembered after a reload.
  const dx = box.getByTestId('labels-offset-x');
  await dx.fill('1,5');
  await dx.blur();
  await page.reload();
  await expect(page.getByTestId('export-labels')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('labels-offset-x')).toHaveValue('1,5');
  await expect(page.getByTestId('labels-preset')).toHaveText(l.presets.custom);

  const href = await page.getByTestId('export-labels-open').getAttribute('href');
  expect(href).toMatch(/\/labels\?revision=\d+&preset=custom&cols=2&.*&dx=1\.5$/);
  const res = await page.request.get(href ?? '');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('application/pdf');
});
