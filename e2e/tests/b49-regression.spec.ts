import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  downloadAndVerifyNc,
  downloadDocuments,
  nestNow,
  simulationGreen,
  view3d,
} from './regression-helpers';
import {
  KITCHEN,
  fill,
  giveSheetGrain,
  goStep,
  openNewProject,
  paste,
  projectId,
  saved,
  watchConsole,
} from './wizard-helpers';

/**
 * T190: the full regression scenarios (spec §11) = what the owner repeats on the machine day.
 * Each one: input → nest → 3D → simulation → NC (judged on its own by the reader + every automatic
 * check) + layout DXF + parts DXF + A4 PDF + labels. Kept as one file so a release run is one line:
 * `pnpm e2e:local tests/b49-regression.spec.ts`.
 */

const t = tr.cutList;
const DOOR = ['Parça adı\tEn\tBoy\tAdet\tDamar', 'Kapak\t396\t716\t1\thayır'].join('\n');
const dxfFixture = (name: string) =>
  fileURLToPath(new URL(`../../packages/core/src/dxf/__fixtures__/${name}`, import.meta.url));

interface SavedProject {
  revision: number;
  project: {
    stock: { sheet: { grain: number | null } };
    parts: { id: string; qty: number; grain: { mode: 'free' | 'fixed'; angle: number } }[];
    layout: {
      sheets: { offcutId?: string; placements: { partId: string; rot: number }[] }[];
    } | null;
  };
}

async function savedProject(page: Page, id: string): Promise<SavedProject> {
  return (await (await page.request.get(`/api/projects/${id}`)).json()) as SavedProject;
}

test.describe('T190 full regression (machine-day scenarios)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
  });

  test('1 kitchen base cabinet from the generator → all outputs', async ({ page }) => {
    test.setTimeout(240_000);
    const problems = watchConsole(page);
    await openNewProject(page, 'parcalar');
    await page.getByTestId('cabinet-open').click();
    await page.getByTestId('cabinet-add').click();
    await expect(page.getByTestId('cabinet-dialog')).toHaveCount(0);
    // Default base unit: 2 sides, top, bottom, 1 shelf, 1 door (the 8 mm back stays out).
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(t.count, { rows: 5, pieces: 6 }),
    );
    await saved(page);
    const id = await projectId(page);

    const sheets = await nestNow(page);
    await view3d(page);
    await saved(page);
    await simulationGreen(page);
    const { verdict } = await downloadAndVerifyNc(page, id, sheets);
    expect(verdict.partsExpected).toBe(6);
    await downloadDocuments(page, 1);
    expect(problems).toEqual([]);
  });

  test('2 hinged door with the ready hinge + handle templates (holes and pockets) → all outputs', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    const problems = watchConsole(page);
    await openNewProject(page, 'parcalar');
    await paste(page, DOOR, 1);
    await page.getByTestId('parts-view-drawing').click();
    await expect(page.getByTestId('editor-canvas')).toHaveAttribute('data-view', /\d/);
    const door = page.getByTestId('editor-part-list').getByRole('button').first();
    await door.click();
    for (const name of ['Menteşe çukuru Ø35 (2 menteşe)', 'Kulp deliği 128 mm']) {
      await page.getByTestId('template-add').click();
      await page.getByTestId('template-menu-item').filter({ hasText: name }).click();
      await page.getByTestId('template-place').click();
      await expect(page.getByTestId('template-pending')).toBeHidden();
      await door.click();
    }
    await expect(page.getByTestId('template-instance-1')).toContainText('Kulp deliği');
    await saved(page);
    const id = await projectId(page);

    const sheets = await nestNow(page);
    expect(sheets).toBe(1);
    await view3d(page);
    await simulationGreen(page);
    // The checklist also asks for the unverified templates line; the helper ticks every line.
    const { files, verdict } = await downloadAndVerifyNc(page, id, 1);
    // Loops cut: the door outline + the 2 through handle holes (the cups are blind pockets).
    expect(verdict.partsExpected).toBe(3);
    const nc = files[0]?.content ?? '';
    expect(nc.split(/\r?\n/).some((l) => l.startsWith('(SABLON DOGRULANMADI'))).toBe(true);
    await downloadDocuments(page, 1);
    expect(problems).toEqual([]);
  });

  test('3 DXF sign letters (outline + counter) → all outputs', async ({ page }) => {
    test.setTimeout(240_000);
    const problems = watchConsole(page);
    await openNewProject(page, 'parcalar');
    await page.getByTestId('dxf-open').click();
    const dialog = page.getByTestId('dxf-dialog');
    await dialog.getByTestId('dxf-file').setInputFiles(dxfFixture('sign-letters-400.dxf'));
    await expect(dialog.getByTestId('dxf-preview')).toHaveAttribute('data-parts', '3');
    await dialog.getByTestId('dxf-confirm').click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(t.count, { rows: 3, pieces: 3 }),
    );
    await saved(page);
    const id = await projectId(page);

    const sheets = await nestNow(page);
    await view3d(page);
    await simulationGreen(page);
    const { verdict } = await downloadAndVerifyNc(page, id, sheets);
    // 3 letter outlines + the counter of the O.
    expect(verdict.partsExpected).toBe(4);
    await downloadDocuments(page, 1);
    expect(problems).toEqual([]);
  });

  test('4 grain-rotated panels on a 90° sheet (3 sheets) → grain rule kept, all outputs', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const problems = watchConsole(page);
    await openNewProject(page, 'makine');
    await giveSheetGrain(page);
    await page.getByTestId('sheet-grain-dial-quick-90').click();
    await expect(page.getByTestId('sheet-grain-dial')).toHaveAttribute('aria-valuenow', '90');
    await saved(page);
    const id = await projectId(page);
    await goStep(page, 'parcalar');
    await paste(page, KITCHEN, 5);

    const sheets = await nestNow(page);
    expect(sheets).toBeGreaterThan(1);
    await view3d(page);
    await saved(page);
    // Every grain-locked piece lies along the sheet grain (part angle + rotation ≡ 90 mod 180).
    const { project } = await savedProject(page, id);
    expect(project.stock.sheet.grain).toBe(90);
    const fixed = new Map(
      project.parts.filter((p) => p.grain.mode === 'fixed').map((p) => [p.id, p.grain.angle]),
    );
    const placed = (project.layout?.sheets ?? []).flatMap((s) => s.placements);
    expect(placed).toHaveLength(30);
    const grained = placed.filter((p) => fixed.has(p.partId));
    expect(grained).toHaveLength(18);
    for (const p of grained) expect(((fixed.get(p.partId) ?? 0) + p.rot) % 180).toBe(90);

    await simulationGreen(page);
    const { verdict } = await downloadAndVerifyNc(page, id, sheets);
    expect(verdict.partsExpected).toBe(30);
    await downloadDocuments(page, 1);
    expect(problems).toEqual([]);
  });

  test('5 offcut reuse: a saved offcut is nested first → all outputs', async ({ page }) => {
    test.setTimeout(300_000);
    const problems = watchConsole(page);
    // A first job leaves offcuts; the operator saves them.
    await openNewProject(page, 'parcalar');
    await paste(page, 'Ad\tEn\tBoy\tAdet\nYan\t600\t500\t2', 1);
    await nestNow(page);
    const proposals = page.getByTestId('offcut-proposal');
    await expect(proposals.first()).toBeVisible();
    for (const box of await proposals.all()) await box.check();
    await page.getByTestId('offcut-save').click();
    await expect(page.getByTestId('offcut-saved')).toBeVisible();
    await saved(page);
    await page.goto('/projeler');
    await page.getByTestId('offcuts-tab').click();
    await expect(
      page.locator('[data-testid="offcut-row"][data-status="available"]').first(),
    ).toBeVisible();

    // The next job of the same material uses the stock offcut first.
    await openNewProject(page, 'parcalar');
    await paste(page, 'Ad\tEn\tBoy\tAdet\nRaf\t300\t300\t1', 1);
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(t.count, { rows: 1, pieces: 1 }),
    );
    await saved(page);
    const id = await projectId(page);
    await goStep(page, 'dizilim');
    await page.getByTestId('layout-use-offcuts').click();
    await expect(page.getByTestId('layout-offcut-count')).not.toHaveAttribute('data-count', '0');
    const sheets = await nestNow(page);
    expect(sheets).toBe(1);
    await expect(page.getByTestId('nesting-offcuts')).toHaveAttribute('data-count', '1', {
      timeout: 20_000,
    });
    await view3d(page);
    await saved(page);
    const { project } = await savedProject(page, id);
    expect(project.layout?.sheets[0]?.offcutId).toBeTruthy();

    await simulationGreen(page);
    const { verdict } = await downloadAndVerifyNc(page, id, 1);
    expect(verdict.partsExpected).toBe(1);
    await downloadDocuments(page, 1);
    expect(problems).toEqual([]);
  });

  test('6 re-export after a change: the old file is marked, the new revision passes', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const problems = watchConsole(page);
    await openNewProject(page, 'parcalar');
    await paste(page, 'Ad\tEn\tBoy\tAdet\nYan\t600\t500\t2', 1);
    await saved(page);
    const id = await projectId(page);
    await nestNow(page);
    await saved(page);
    await simulationGreen(page);
    const first = await downloadAndVerifyNc(page, id, 1);
    expect(first.verdict.partsExpected).toBe(2);
    const r1 = (await savedProject(page, id)).revision;
    expect(first.files[0]?.name).toMatch(new RegExp(`_r${r1}_S1`));

    // The customer wants one more: change the quantity, nest again.
    await goStep(page, 'parcalar');
    const qty = page.getByLabel(fill(t.cellLabel, { n: 1, column: t.columns.qty }), {
      exact: true,
    });
    await qty.fill('3');
    // Tab commits the cell (Enter on the last row would start a new row).
    await qty.press('Tab');
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(t.count, { rows: 1, pieces: 3 }),
    );
    await nestNow(page);
    await saved(page);
    await simulationGreen(page);

    // Export step: the first file is "eski revizyon"; "Güncel revizyonla üret" goes to the checklist.
    await goStep(page, 'export');
    const rows = page.getByTestId('export-history-row');
    await expect(rows).toHaveCount(1, { timeout: 30_000 });
    await expect(rows.first().getByTestId('export-history-old')).toBeVisible();
    await expect(page.getByTestId('export-checklist')).toBeVisible({ timeout: 30_000 });
    await rows.first().getByTestId('export-history-current').click();
    await expect(page.getByTestId('export-checklist').locator(':focus')).toHaveCount(1);

    const second = await downloadAndVerifyNc(page, id, 1);
    expect(second.verdict.partsExpected).toBe(3);
    const r2 = (await savedProject(page, id)).revision;
    expect(r2).toBeGreaterThan(r1);
    expect(second.files[0]?.name).toMatch(new RegExp(`_r${r2}_S1`));
    await expect(rows).toHaveCount(2);
    await downloadDocuments(page, 2);
    expect(problems).toEqual([]);
  });
});
