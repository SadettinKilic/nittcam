import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext, type Download, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { verifyDownloaded, type MachineDetail } from './nc-verify';
import {
  chooseMachine,
  closeWorkspacePanel,
  openWorkspacePanel,
  pickOption,
  fill,
  openNewProject,
  paste,
  projectId,
  saved,
  watchConsole,
  wizardReady,
} from './wizard-helpers';

/**
 * T024: the M1 exit criterion (spec §11, §12). A workshop user goes from a pasted Excel cut list
 * to a downloaded NC file through the real UI; the downloaded bytes are then judged on their own:
 * the project's G-code reader and automatic checks run over them in node (not the server's run),
 * and the header, the sha256 and the counts are compared with what the UI showed.
 */

const w = tr.wizard;
const PROJECT_NAME = 'Mutfak dolabi T024';

/** A small kitchen cabinet set as pasted from Excel: comma decimals, edge-band columns, grain. */
const CABINET = [
  'Parça Adı\tEn\tBoy\tAdet\tDamar\tÜst\tAlt\tSol\tSağ',
  'Yan panel\t560\t720\t4\tevet\t0,8\t0,8\t0\t0',
  'Taban\t564\t560\t2\thayır\t0\t0\t0\t0',
  'Kapak\t596,5\t716\t4\tevet\t2\t2\t2\t2',
  'Raf\t564\t519,5\t4\thayır\t0,8\t0\t0\t0',
  'Çekmece önü\t596,5\t176\t2\tevet\t2\t2\t2\t2',
].join('\n');
const CABINET_ROWS = 5;
const CABINET_PIECES = 16;

/** The workshop's machine profile: a copy of the seeded example under its own name (via API). */
async function createWorkshopMachine(request: APIRequestContext): Promise<string> {
  const list = (await (await request.get('/api/machines')).json()) as { id: string }[];
  const first = list[0];
  if (!first) throw new Error('no seeded machine');
  const seeded = (await (await request.get(`/api/machines/${first.id}`)).json()) as MachineDetail;
  const name = `T024 atölye router ${Math.random().toString(36).slice(2, 8)}`;
  const profile = { ...seeded.profile, identity: { ...seeded.profile.identity, name } };
  const res = await request.post('/api/machines', { data: { profile } });
  expect(res.status()).toBe(201);
  return name;
}

/** Folds Turkish letters so a name can be compared with the post's ASCII-only header. */
const fold = (s: string) =>
  s.replace(/[İı]/g, 'i').toLocaleLowerCase('en').normalize('NFD').replace(/[̀-ͯ]/g, '');

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function runFlow(page: Page, mobile: boolean) {
  const problems = watchConsole(page);
  const machineName = await createWorkshopMachine(page.request);

  // --- Step 1: machine, material, sheet, project name ---------------------------------------
  await openNewProject(page, 'makine');
  await chooseMachine(page, machineName);
  await pickOption(page.getByTestId('wizard-material'), tr.materials.mdf);
  const thickness = page.getByTestId('wizard-thickness');
  await thickness.fill('18');
  await thickness.press('Enter');
  await page.getByLabel(fill(w.machine.preset, { a: '2.070', b: '2.800' })).check();
  await expect(page.getByTestId('cutting-params')).toBeVisible();
  await expect(page.getByTestId('sheet-preview')).toHaveAttribute('data-fits', 'true');
  const name = page.getByTestId('project-name');
  await name.fill(PROJECT_NAME);
  await name.press('Enter');
  if (mobile) await noHorizontalScroll(page);

  // --- Step 2: paste the Excel cut list ------------------------------------------------------
  await page.getByTestId('wizard-next').click();
  await wizardReady(page, 'parcalar');
  await paste(page, CABINET, CABINET_ROWS);
  await expect(page.getByTestId('cut-list-count')).toHaveText(
    fill(tr.cutList.count, { rows: CABINET_ROWS, pieces: CABINET_PIECES }),
  );
  await saved(page);
  const id = await projectId(page);
  // T246: no issues = a Sorun yok chip instead of the panel.
  await expect(page.getByTestId('cut-list-issue-chip')).toHaveAttribute('data-count', '0');
  if (mobile) await noHorizontalScroll(page);

  // --- Step 3: nesting, then lock one part ---------------------------------------------------
  await page.getByTestId('wizard-next').click();
  await wizardReady(page, 'dizilim');
  await page.getByRole('button', { name: tr.cutList.nesting.run, exact: true }).click();
  await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
  // T198: on phones the nesting summary (left) and the part inspector (right) are bottom sheets.
  if (mobile) await openWorkspacePanel(page, 'left');
  const sheets = Number(await page.getByTestId('nesting-sheets').innerText());
  expect(sheets).toBeGreaterThanOrEqual(1);
  if (mobile) {
    await closeWorkspacePanel(page);
    await openWorkspacePanel(page, 'right');
  }
  await pickOption(page.getByTestId('layout-select'), { index: 1 });
  await page.getByRole('button', { name: tr.layout.info.lock }).click();
  await expect(page.getByTestId('layout-info-locked')).toHaveText(tr.layout.info.lockedYes);
  if (mobile) await closeWorkspacePanel(page);
  await saved(page);
  if (mobile) await noHorizontalScroll(page);

  // --- Step 4: simulation, every check green -------------------------------------------------
  await page.getByTestId('wizard-next').click();
  await wizardReady(page, 'simulasyon');
  await expect(page.getByTestId('sim-canvas').locator('canvas').first()).toBeVisible({
    timeout: 30_000,
  });
  if (mobile) await openWorkspacePanel(page, 'left');
  await expect(page.getByTestId('sim-check-status')).toHaveAttribute('data-ok', 'true', {
    timeout: 30_000,
  });
  if (mobile) await closeWorkspacePanel(page);
  if (mobile) await noHorizontalScroll(page);

  // T262: the G-code panel shows the header of the file the export step will download.
  let panelHead: { name: string; lines: string[] } | null = null;
  if (!mobile) {
    const panel = page.getByTestId('gcode-panel');
    const savedRevision = await page.getByTestId('save-status').getAttribute('data-revision');
    const headLines = () =>
      panel.locator('button[data-file="0"]').evaluateAll((els) =>
        els
          .map((e) => ({ n: Number(e.getAttribute('data-line')), t: e.getAttribute('data-text') }))
          .sort((a, b) => a.n - b.n)
          .filter((r) => r.n <= 12)
          .map((r) => r.t ?? ''),
      );
    await expect
      .poll(async () => (await headLines()).join('\n'))
      .toMatch(new RegExp(`\\(REV[İI]ZYON: ${savedRevision}\\)`));
    panelHead = {
      name: (await panel.getByTestId('gcode-file').first().getAttribute('data-name')) ?? '',
      lines: await headLines(),
    };
    expect(panelHead.lines).toHaveLength(12);
  }

  // --- Step 5: checklist + acceptance → download ---------------------------------------------
  await page.getByTestId('wizard-next').click();
  await wizardReady(page, 'export');
  await expect(page.getByTestId('export-status')).toHaveAttribute('data-ok', 'true', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('export-files').locator('li')).toHaveCount(sheets);
  const download = page.getByTestId('export-download');
  await expect(download).toBeDisabled();
  await page.getByTestId('export-check-origin').check();
  await page.getByTestId('export-check-tool').check();
  await page.getByTestId('export-check-aircut').check();
  await page.getByTestId('export-accept').check();
  await expect(download).toBeEnabled();
  const revision = Number(await page.getByTestId('save-status').getAttribute('data-revision'));
  if (mobile) await noHorizontalScroll(page);

  const downloaded: { name: string; bytes: Buffer }[] = [];
  const take = async (d: Download) => {
    downloaded.push({ name: d.suggestedFilename(), bytes: await readFile(await d.path()) });
  };
  if (sheets === 1) {
    const [d] = await Promise.all([page.waitForEvent('download'), download.click()]);
    await take(d);
  } else {
    await download.click();
    // T176: one link per sheet plus "Tümünü indir (.zip)".
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
  await expect(page.getByTestId('export-history-row')).toHaveCount(1);
  expect(downloaded).toHaveLength(sheets);

  // --- Independent verification of the downloaded bytes --------------------------------------
  const records = (await (await page.request.get(`/api/projects/${id}/exports`)).json()) as {
    revision: number;
    hash: string;
    files: { name: string; hash: string; sheet: number }[];
  }[];
  expect(records).toHaveLength(1);
  const record = records[0];
  if (!record) throw new Error('no export record');
  expect(record.revision).toBe(revision);
  expect(record.files).toHaveLength(sheets);
  if (panelHead) {
    const head = panelHead;
    const file = downloaded.find((d) => d.name === head.name);
    expect(file, `panel file ${head.name} is downloaded`).toBeDefined();
    const lines = (file?.bytes.toString('utf8') ?? '').split('\n').slice(0, 12);
    expect(lines.map((l) => l.replace(/\r$/, ''))).toEqual(head.lines);
  }

  const checkFiles = downloaded.map((d) => {
    const stored = record.files.find((f) => f.name === d.name);
    if (!stored) throw new Error(`downloaded ${d.name} is not in the export record`);
    // The downloaded file equals the stored export, byte for byte.
    expect(createHash('sha256').update(d.bytes).digest('hex')).toBe(stored.hash);
    const content = d.bytes.toString('utf8');
    expect(content.replace(/[\t\r\n -~]/g, '')).toBe(''); // ASCII-only
    const head = content.split('\n').slice(0, 12).join('\n');
    expect(fold(head)).toContain(`(proje: ${fold(PROJECT_NAME)}`);
    expect(head).toMatch(new RegExp(`\\(REV[İI]ZYON: ${revision}\\)`));
    expect(content.split('\n')[0]).toContain('DOGRULANMADI, once air cut');
    return { name: d.name, content, sheet: stored.sheet };
  });
  // The manifest hash (sha256sum style, in record order) equals the stored export hash.
  const manifest = record.files.map((f) => `${f.hash}  ${f.name}\n`).join('');
  expect(createHash('sha256').update(manifest).digest('hex')).toBe(record.hash);

  const verdict = await verifyDownloaded(page.request, id, checkFiles);
  expect(verdict.violations).toEqual([]);
  expect(verdict.ok).toBe(true);
  expect(verdict.files).toHaveLength(sheets);
  // Part count: what the UI said (16 pieces) equals what the G-code cuts and what the layout expects.
  expect(verdict.partsExpected).toBe(CABINET_PIECES);
  expect(verdict.partsCut).toBe(CABINET_PIECES);

  expect(problems).toEqual([]);
}

test.describe('T024 end-to-end: cut list → NC download (M1 exit)', () => {
  test('desktop: machine → wizard → paste → nesting → lock → simulation → export → file passes all checks', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await runFlow(page, false);
  });

  test('mobile 390 px: the same flow, no horizontal scroll', async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await runFlow(page, true);
  });
});
