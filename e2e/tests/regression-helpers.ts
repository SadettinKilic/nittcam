/**
 * T190: shared steps of the full regression scenarios (`b49-regression.spec.ts`). Each scenario is
 * what the owner repeats on the machine day: input → nest → 3D → simulation → NC + PDF + DXF +
 * labels, with the downloaded NC judged on its own by the G-code reader and automatic checks.
 * Every wait is on a state attribute or an event, never on a timer.
 */
import { readFile } from 'node:fs/promises';
import { expect, type Download, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { verifyDownloaded } from './nc-verify';
import { goStep } from './wizard-helpers';

const w = tr.wizard;

/** "Diz" on the Dizilim step; returns the sheet count the step shows. */
export async function nestNow(page: Page): Promise<number> {
  await goStep(page, 'dizilim');
  await page
    .locator(
      'button[data-testid^="layout-mode-"][aria-pressed="true"]:visible, [data-testid="layout-nest-compact"]:visible',
    )
    .click();
  await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
  const sheets = page.getByTestId('nesting-sheets');
  await expect(sheets).toHaveText(/^\d+$/, { timeout: 20_000 });
  return Number(await sheets.textContent());
}

/** Dizilim step: the 3D preview renders (and the 2D view comes back). */
export async function view3d(page: Page) {
  await page.getByTestId('view-3d').click();
  await expect(page.getByTestId('preview3d')).toHaveAttribute('data-ready', 'true', {
    timeout: 30_000,
  });
}

/** Simulasyon step: the canvas draws and every check is green. */
export async function simulationGreen(page: Page) {
  await goStep(page, 'simulasyon');
  await expect(page.getByTestId('sim-canvas').locator('canvas').first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId('sim-check-status')).toHaveAttribute('data-ok', 'true', {
    timeout: 30_000,
  });
}

/** Export step: waits for the server checks, then ticks every checklist line and the acceptance. */
export async function confirmChecklist(page: Page) {
  await expect(page.getByTestId('export-status')).toHaveAttribute('data-ok', 'true', {
    timeout: 30_000,
  });
  const download = page.getByTestId('export-download');
  await expect(download).toBeDisabled();
  const boxes = page.getByTestId('export-checklist').getByRole('checkbox');
  await expect(boxes.first()).toBeVisible();
  for (const box of await boxes.all()) await box.check();
  await page.getByTestId('export-accept').check();
  await expect(download).toBeEnabled();
}

export interface NcFile {
  name: string;
  content: string;
  sheet: number;
}

/**
 * Export step: checklist + acceptance → "İndir" (one file, or one link per sheet + zip), then the
 * independent verification of every downloaded file. Returns the files and the verdict.
 */
export async function downloadAndVerifyNc(page: Page, id: string, sheets: number) {
  await goStep(page, 'export');
  await confirmChecklist(page);
  const taken: { name: string; content: string }[] = [];
  const take = async (d: Download) =>
    taken.push({
      name: d.suggestedFilename(),
      content: (await readFile(await d.path())).toString(),
    });
  const download = page.getByTestId('export-download');
  if (sheets === 1) {
    const [d] = await Promise.all([page.waitForEvent('download'), download.click()]);
    await take(d);
  } else {
    await download.click();
    await expect(page.getByTestId('export-zip')).toHaveText(w.export.zip);
    const links = page
      .getByTestId('export-ready')
      .getByRole('link')
      .filter({ hasNotText: w.export.zip });
    await expect(links).toHaveCount(sheets);
    for (let i = 0; i < sheets; i++) {
      const [d] = await Promise.all([page.waitForEvent('download'), links.nth(i).click()]);
      await take(d);
    }
  }
  await expect(page.getByTestId('export-ready')).toBeVisible();
  // The record of this export lists exactly the downloaded names; its sheet index is the truth.
  const records = (await (await page.request.get(`/api/projects/${id}/exports`)).json()) as {
    revision: number;
    kind?: string;
    files: { name: string; sheet: number }[];
  }[];
  const files: NcFile[] = taken.map((t) => {
    const stored = records.flatMap((r) => r.files).find((f) => f.name === t.name);
    if (!stored) throw new Error(`downloaded ${t.name} is not in an export record`);
    // Every NC file starts with the unverified-post warning until the machine is verified.
    expect(t.content.split('\n')[0]).toContain('DOGRULANMADI, once air cut');
    return { ...t, sheet: stored.sheet };
  });
  expect(files).toHaveLength(sheets);
  const verdict = await verifyDownloaded(page.request, id, files);
  expect(verdict.violations).toEqual([]);
  expect(verdict.ok).toBe(true);
  expect(verdict.partsCut).toBe(verdict.partsExpected);
  return { files, verdict };
}

const DOCS = [
  { type: 'dxf-dizilim', name: /_r\d+_dizilim\.dxf$/ },
  { type: 'dxf-parcalar', name: /_r\d+_parcalar\.dxf$/ },
  { type: 'pdf-a4', name: /_r\d+_a4\.pdf$/ },
] as const;

/**
 * Export step: the layout DXF, the parts DXF, the A4 PDF and the label PDF download, each with
 * the right name and a valid file start; every document becomes a history row (`rowsBefore`
 * = the history rows already there).
 */
export async function downloadDocuments(page: Page, rowsBefore: number) {
  await goStep(page, 'export');
  const box = page.getByTestId('export-documents');
  const rows = page.getByTestId('export-history-row');
  await expect(rows).toHaveCount(rowsBefore, { timeout: 30_000 });
  for (const doc of DOCS) {
    const button = box.getByTestId(`export-doc-${doc.type}`);
    await expect(button).toBeEnabled({ timeout: 30_000 });
    const [d] = await Promise.all([page.waitForEvent('download'), button.click()]);
    expect(d.suggestedFilename()).toMatch(doc.name);
    const bytes = await readFile(await d.path());
    if (doc.type === 'pdf-a4') expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    else {
      const text = bytes.toString('utf8');
      expect(text).toContain('SECTION');
      expect(text.trimEnd().endsWith('EOF')).toBe(true);
    }
  }
  const labels = page.getByTestId('export-labels-download');
  await expect(labels).toBeEnabled();
  const [l] = await Promise.all([page.waitForEvent('download'), labels.click()]);
  expect(l.suggestedFilename()).toMatch(/\.pdf$/);
  expect((await readFile(await l.path())).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  await expect(rows).toHaveCount(rowsBefore + DOCS.length + 1);
}
