import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test, type Download, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  buildToolpath,
  checkGcodeFiles,
  expectedLayouts,
  parsePostConfig,
  type MachineProfile,
  type Project,
  type VerificationState,
} from '../../packages/core/src/index';
import {
  fill,
  goStep,
  openNewProject,
  pickOption,
  projectId,
  saved,
  wizardReady,
} from './wizard-helpers';

// B16 / T146: DXF import dialog. Sign letters DXF → parts → nest → NC that passes the checks
// (half of the M5 exit), DWG refused, unit question, layer mapping remembered per company.

const t = tr.dxfImport;
const fixture = (name: string) =>
  fileURLToPath(new URL(`../../packages/core/src/dxf/__fixtures__/${name}`, import.meta.url));

async function openDialog(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await page.getByTestId('dxf-open').click();
  const dialog = page.getByTestId('dxf-dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('T146 DXF import dialog', () => {
  test('DWG is refused with "DXF olarak kaydedin"; wrong type too', async ({ page }) => {
    const dialog = await openDialog(page);
    await dialog.getByTestId('dxf-file').setInputFiles({
      name: 'tabela.dwg',
      mimeType: 'application/acad',
      buffer: Buffer.from('AC1032\u0000\u0000\u0000binary'),
    });
    await expect(dialog.getByTestId('dxf-problem')).toHaveText(t.problems.dwg);
    await expect(dialog.getByTestId('dxf-problem')).toContainText('DXF olarak kaydedin');
    await expect(dialog.getByTestId('dxf-confirm')).toBeDisabled();
    await dialog.getByTestId('dxf-file').setInputFiles({
      name: 'logo.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg/>'),
    });
    await expect(dialog.getByTestId('dxf-problem')).toHaveText(t.problems.type);
  });

  test('missing units: the unit is asked before the import, the size follows the choice', async ({
    page,
  }) => {
    const dialog = await openDialog(page);
    await dialog.getByTestId('dxf-file').setInputFiles(fixture('no-units-small.dxf'));
    await expect(dialog.getByTestId('dxf-preview')).toBeVisible();
    await expect(dialog.getByText(t.unit.question)).toBeVisible();
    await expect(dialog.getByTestId('dxf-confirm')).toBeDisabled();
    await pickOption(dialog.getByTestId('dxf-unit'), t.unit.names.cm);
    await expect(dialog.getByTestId('dxf-size')).toHaveText('20 × 30 mm');
    await expect(dialog.getByTestId('dxf-confirm')).toBeEnabled();
  });

  test('report, layer mapping, one undo step, mapping remembered', async ({ page }) => {
    const dialog = await openDialog(page);
    await dialog.getByTestId('dxf-file').setInputFiles(fixture('rect-lines-gaps.dxf'));
    await expect(dialog.getByTestId('dxf-file-name')).toHaveText('rect-lines-gaps.dxf');
    await expect(dialog.getByTestId('dxf-report-parts')).toHaveAttribute('data-value', '1');
    await expect(dialog.getByTestId('dxf-report-ignored')).toHaveAttribute('data-value', '4');
    await expect(dialog.getByTestId('dxf-report-duplicates')).toHaveAttribute('data-value', '1');
    await expect(dialog.getByTestId('dxf-report-open')).toHaveAttribute('data-value', '1');
    await expect(dialog.getByTestId('dxf-open-warning')).toBeVisible();
    // The open scribe line goes away when its layer is not imported.
    await pickOption(dialog.getByTestId('dxf-layer-SCRIBE'), t.layers.ops.ignore);
    await expect(dialog.getByTestId('dxf-report-open')).toHaveCount(0);
    await dialog.getByTestId('dxf-confirm').click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByText(fill(t.added, { file: 'rect-lines-gaps.dxf', count: 1 })),
    ).toBeVisible();
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(tr.cutList.count, { rows: 1, pieces: 1 }),
    );
    await saved(page);
    // One undo step removes the import.
    await page.getByTestId('wizard-undo').click();
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(tr.cutList.count, { rows: 0, pieces: 0 }),
    );
    // The company remembers SCRIBE → Alma.
    await expect
      .poll(
        async () =>
          (
            (await (await page.request.get('/api/settings/dxf-layers')).json()) as {
              map: Record<string, string>;
            }
          ).map.SCRIBE,
      )
      .toBe('ignore');
    await page.getByTestId('dxf-open').click();
    await page.getByTestId('dxf-file').setInputFiles(fixture('rect-lines-gaps.dxf'));
    await expect(page.getByTestId('dxf-layer-SCRIBE')).toHaveAttribute('data-value', 'ignore');
  });

  test('sign letters DXF → nest → NC download passes the automatic checks', async ({ page }) => {
    test.setTimeout(180_000);
    const dialog = await openDialog(page);
    await dialog.getByTestId('dxf-file').setInputFiles(fixture('sign-letters-400.dxf'));
    await expect(dialog.getByTestId('dxf-preview')).toHaveAttribute('data-parts', '3');
    await expect(dialog.getByTestId('dxf-report-inners')).toHaveAttribute('data-value', '1');
    await expect(dialog.getByTestId('dxf-unit-known')).toBeVisible();
    await dialog.getByTestId('dxf-confirm').click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(tr.cutList.count, { rows: 3, pieces: 3 }),
    );
    await saved(page);
    const id = await projectId(page);

    await goStep(page, 'dizilim');
    await page
      .locator(
        'button[data-testid^="layout-mode-"][aria-pressed="true"]:visible, [data-testid="layout-nest-compact"]:visible',
      )
      .click();
    await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
    await saved(page);

    await page.getByTestId('wizard-next').click();
    await wizardReady(page, 'simulasyon');
    await expect(page.getByTestId('sim-check-status')).toHaveAttribute('data-ok', 'true', {
      timeout: 30_000,
    });

    await page.getByTestId('wizard-next').click();
    await wizardReady(page, 'export');
    await expect(page.getByTestId('export-status')).toHaveAttribute('data-ok', 'true', {
      timeout: 30_000,
    });
    await page.getByTestId('export-check-origin').check();
    await page.getByTestId('export-check-tool').check();
    await page.getByTestId('export-check-aircut').check();
    await page.getByTestId('export-accept').check();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-download').click(),
    ]);
    const content = (await readFile(await (download as Download).path())).toString('utf8');

    // Judge the downloaded bytes on their own: reader + automatic checks in node.
    const project = (
      (await (await page.request.get(`/api/projects/${id}`)).json()) as { project: Project }
    ).project;
    const machine = (await (
      await page.request.get(`/api/machines/${project.machine.machineId}`)
    ).json()) as {
      state: VerificationState;
      profile: MachineProfile & { post: { id: string } };
    };
    const cfg = parsePostConfig(
      JSON.parse(
        await readFile(
          new URL(
            `../../packages/machines/${machine.profile.post.id}/v1/post.json`,
            import.meta.url,
          ),
          'utf8',
        ),
      ) as unknown,
    );
    if (!cfg.ok) throw new Error('post config invalid');
    const tp = buildToolpath(project, machine.profile, {});
    if (!tp.ok) throw new Error('toolpath failed');
    const verdict = checkGcodeFiles([{ name: download.suggestedFilename(), content, sheet: 0 }], {
      profile: machine.profile,
      verification: machine.state,
      post: cfg.config,
      toolpath: tp.toolpath,
      stock: {
        thickness: project.stock.thickness,
        sheetWidth: project.stock.sheet.width,
        sheetHeight: project.stock.sheet.height,
      },
      layout: expectedLayouts(project),
    });
    expect(verdict.violations).toEqual([]);
    expect(verdict.ok).toBe(true);
    // 4 closed loops expected and cut: 3 letter outlines + the counter of the O.
    expect(verdict.files[0]?.result.summary.partsExpected).toBe(4);
    expect(verdict.files[0]?.result.summary.partsCut).toBe(4);
  });
});
