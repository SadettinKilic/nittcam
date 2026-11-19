import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
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
import { goStep, openGrainedProject, paste, projectId, saved, wizardReady } from './wizard-helpers';

/**
 * T117 (spec §11, D-034): sheet grain 0°, part A fixed 0°, B fixed 90°, C fixed 30°. Nesting turns
 * each part so its grain runs along the sheet grain (A 0/180, B 90/270, C 330/150); the
 * simulation and the NC download pass every automatic check, re-run here on the downloaded bytes.
 */
const PARTS = [
  'Parça adı\tEn\tBoy\tAdet',
  'A\t400\t700\t1',
  'B\t300\t500\t1',
  'C\t300\t600\t1',
].join('\n');

async function setGrain(page: Page, row: number, angle: number) {
  await page.getByTestId(`grain-cell-${row}`).click();
  const input = page.getByTestId(`grain-dial-${row}-input`);
  await input.fill(String(angle));
  await input.press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId(`grain-cell-${row}`)).toHaveAttribute('data-mode', 'fixed');
  await expect(page.getByTestId(`grain-cell-${row}`)).toHaveAttribute('data-angle', String(angle));
}

const ALLOWED: Record<string, number[]> = { A: [0, 180], B: [90, 270], C: [330, 150] };

test('T117 grain end to end: 0° / 90° / 30° parts → nesting → simulation → NC passes', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await openGrainedProject(page);
  await expect(page.getByTestId('sheet-grain-dial')).toHaveAttribute('aria-valuenow', '0');
  await goStep(page, 'parcalar');
  await paste(page, PARTS, 3);
  await setGrain(page, 1, 0);
  await setGrain(page, 2, 90);
  await setGrain(page, 3, 30);

  await goStep(page, 'dizilim');
  await page.getByRole('button', { name: tr.cutList.nesting.run, exact: true }).click();
  await expect(page.getByTestId('layout-canvas')).toHaveAttribute('data-part-count', '3', {
    timeout: 20_000,
  });
  await saved(page);
  const id = await projectId(page);
  const project = (
    (await (await page.request.get(`/api/projects/${id}`)).json()) as { project: Project }
  ).project;
  const byId = new Map(project.parts.map((p) => [p.id, p.name]));
  const placed = project.layout.sheets.flatMap((s) => s.placements);
  expect(placed).toHaveLength(3);
  for (const pl of placed) {
    const name = byId.get(pl.partId) ?? '';
    expect(ALLOWED[name], `${name} at ${pl.rot}°`).toContain(pl.rot);
  }

  await goStep(page, 'simulasyon');
  await expect(page.getByTestId('sim-check-status')).toHaveAttribute('data-ok', 'true', {
    timeout: 30_000,
  });

  await goStep(page, 'export');
  await wizardReady(page, 'export');
  await expect(page.getByTestId('export-status')).toHaveAttribute('data-ok', 'true', {
    timeout: 30_000,
  });
  const sheets = project.layout.sheets.length;
  await page.getByTestId('export-check-origin').check();
  await page.getByTestId('export-check-tool').check();
  await page.getByTestId('export-check-aircut').check();
  await page.getByTestId('export-accept').check();
  const download = page.getByTestId('export-download');
  await expect(download).toBeEnabled();
  const files: { name: string; content: string; sheet: number }[] = [];
  if (sheets === 1) {
    const [d] = await Promise.all([page.waitForEvent('download'), download.click()]);
    files.push({
      name: d.suggestedFilename(),
      content: await readFile(await d.path(), 'utf8'),
      sheet: 0,
    });
  } else {
    await download.click();
    const links = page.getByTestId('export-ready').getByRole('link');
    await expect(links).toHaveCount(sheets);
    for (let i = 0; i < sheets; i++) {
      const [d] = await Promise.all([page.waitForEvent('download'), links.nth(i).click()]);
      files.push({
        name: d.suggestedFilename(),
        content: await readFile(await d.path(), 'utf8'),
        sheet: i,
      });
    }
  }

  // Independent re-check of the downloaded bytes against the saved project.
  const machine = (await (
    await page.request.get(`/api/machines/${project.machine.machineId}`)
  ).json()) as { profile: MachineProfile; state: VerificationState };
  const postRaw: unknown = JSON.parse(
    await readFile(
      new URL(`../../packages/machines/${machine.profile.post.id}/v1/post.json`, import.meta.url),
      'utf8',
    ),
  );
  const cfg = parsePostConfig(postRaw);
  if (!cfg.ok) throw new Error('post config invalid');
  const tp = buildToolpath(project, machine.profile, {});
  if (!tp.ok) throw new Error('toolpath failed');
  const verdict = checkGcodeFiles(files, {
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
});
