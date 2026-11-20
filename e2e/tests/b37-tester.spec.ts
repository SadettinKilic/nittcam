import { createHash } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  goStep,
  openNewProject,
  paste,
  pasteAndNest,
  projectId,
  saved,
  toastsSettled,
  watchConsole,
} from './wizard-helpers';

/**
 * Tester (B37): the zip opens as a plain stored zip (valid CRC, central directory) and its files
 * are byte for byte the single downloads, with OKU.txt carrying the history hashes; the NC gate is
 * not bypassed (API without acceptance, stale revision, footer button); an old revision re-exported
 * after an edit gives the same record; axe + screenshots of the export step.
 */
const w = tr.wizard.export;

interface Rec {
  exportId: string;
  kind: string;
  revision: number;
  hash: string;
  zipUrl: string | null;
  files: { name: string; size: number; hash: string; sheet: number; downloadUrl: string }[];
}
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = (CRC_TABLE[(c ^ x) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Reads a stored (method 0) zip the way an unzipper does: local headers + central directory. */
function readZip(buf: Uint8Array): Map<string, Uint8Array> {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const out = new Map<string, Uint8Array>();
  let at = 0;
  while (v.getUint32(at, true) === 0x04034b50) {
    const method = v.getUint16(at + 8, true);
    const crc = v.getUint32(at + 14, true);
    const csize = v.getUint32(at + 18, true);
    const usize = v.getUint32(at + 22, true);
    const nlen = v.getUint16(at + 26, true);
    const xlen = v.getUint16(at + 28, true);
    const name = new TextDecoder().decode(buf.subarray(at + 30, at + 30 + nlen));
    const data = buf.subarray(at + 30 + nlen + xlen, at + 30 + nlen + xlen + csize);
    expect(method, name).toBe(0);
    expect(csize, name).toBe(usize);
    expect(crc32(data), `crc ${name}`).toBe(crc);
    expect(name, 'ASCII name for Explorer').toMatch(/^[\x20-\x7e]+$/);
    out.set(name, data);
    at += 30 + nlen + xlen + csize;
  }
  // End of central directory: entry count matches the local headers.
  const eocd = buf.byteLength - 22;
  expect(v.getUint32(eocd, true)).toBe(0x06054b50);
  expect(v.getUint16(eocd + 10, true)).toBe(out.size);
  const cdOffset = v.getUint32(eocd + 16, true);
  expect(v.getUint32(cdOffset, true)).toBe(0x02014b50);
  return out;
}

async function historyOf(request: APIRequestContext, id: string): Promise<Rec[]> {
  return (await (await request.get(`/api/projects/${id}/exports`)).json()) as Rec[];
}

async function exportNc(page: Page) {
  await expect(page.getByTestId('export-status')).toHaveAttribute('data-ok', 'true', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('export-download')).toBeDisabled();
  await page.getByTestId('export-check-origin').check();
  await page.getByTestId('export-check-tool').check();
  await page.getByTestId('export-check-aircut').check();
  for (const id of ['export-check-toolchange', 'export-check-templates']) {
    const box = page.getByTestId(id);
    if (await box.count()) await box.check();
  }
  // Unverified sample machine: still gated until the acceptance.
  await expect(page.getByTestId('export-download')).toBeDisabled();
  await page.getByTestId('export-accept').check();
  await expect(page.getByTestId('export-download')).toBeEnabled();
  await page.getByTestId('export-download').click();
  await expect(page.getByTestId('export-ready')).toBeVisible({ timeout: 30_000 });
}

test('zip = single downloads + OKU.txt hashes; NC gate holds; old revision re-export is the same record', async ({
  page,
  request,
}) => {
  test.setTimeout(240_000);
  const problems = watchConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page);
  await saved(page);
  const id = await projectId(page);
  await goStep(page, 'export');
  const revision = Number(
    (await page.getByTestId('export-revision').textContent())?.match(/\d+/)?.[0],
  );

  // Gate through the API: no acceptance → 428, nothing stored; stale revision → 409.
  const before = (await historyOf(request, id)).length;
  expect((await request.post(`/api/projects/${id}/export`, { data: { revision } })).status()).toBe(
    428,
  );
  expect(
    (
      await request.post(`/api/projects/${id}/export`, {
        data: { revision: revision + 5, acceptUnverified: true },
      })
    ).status(),
  ).toBe(409);
  expect((await historyOf(request, id)).length).toBe(before);
  expect(
    (await (await request.get(`/api/projects/${id}`)).json()) as { status: string },
  ).toMatchObject({ status: 'draft' });

  await exportNc(page);
  const nc = (await historyOf(request, id)).find((r) => r.kind === 'nc');
  if (!nc) throw new Error('no NC record');

  // Zip of the NC export: every file = its single download = its history hash; OKU.txt lists them.
  const zipRes = await request.get(`/api/exports/${nc.exportId}/zip`);
  expect(zipRes.status()).toBe(200);
  expect(zipRes.headers()['content-type']).toBe('application/zip');
  expect(zipRes.headers()['content-disposition']).toMatch(/filename="[\x20-\x7e]+\.zip"/);
  const zipBytes = new Uint8Array(await zipRes.body());
  const entries = readZip(zipBytes);
  expect([...entries.keys()].sort()).toEqual([...nc.files.map((f) => f.name), 'OKU.txt'].sort());
  const readme = new TextDecoder().decode(entries.get('OKU.txt'));
  for (const f of nc.files) {
    const single = new Uint8Array(await (await request.get(f.downloadUrl)).body());
    const inZip = entries.get(f.name);
    if (!inZip) throw new Error(`missing ${f.name}`);
    expect(sha(inZip)).toBe(sha(single));
    expect(sha(inZip)).toBe(f.hash);
    expect(readme).toContain(f.hash);
    expect(readme).toContain(f.name);
  }
  expect(readme).toContain('\r\n');
  // Same export → same zip bytes.
  const again = new Uint8Array(await (await request.get(`/api/exports/${nc.exportId}/zip`)).body());
  expect(sha(again)).toBe(sha(zipBytes));

  // Edit the project (new revision), then re-export the old NC row from the history.
  await goStep(page, 'parcalar');
  await paste(page, ['Parça adı\tEn\tBoy\tAdet', 'Ek raf\t400\t300\t1'].join('\n'), 1);
  await saved(page);
  await goStep(page, 'export');
  await expect(page.getByTestId('export-revision')).toContainText(String(revision + 1));
  // New revision: the footer download is gated again (checks are per revision).
  await expect(page.getByTestId('export-download')).toBeDisabled();
  const rows = page.getByTestId('export-history-row');
  await expect(rows).toHaveCount(1);
  await rows.first().getByTestId('export-reexport').click();
  await expect(page.getByTestId('export-reexport-accept')).toBeVisible();
  // Cancel stores nothing.
  await page.getByRole('button', { name: w.reexportCancel }).click();
  await expect(page.getByTestId('export-reexport-accept')).toHaveCount(0);
  await rows.first().getByTestId('export-reexport').click();
  await page.getByTestId('export-reexport-confirm').click();
  await expect(page.getByText(w.reexportSame)).toBeVisible();
  await expect(rows).toHaveCount(1);
  const after = await historyOf(request, id);
  expect(after.filter((r) => r.kind === 'nc')).toHaveLength(1);
  expect(after[0]).toMatchObject({ exportId: nc.exportId, hash: nc.hash, revision });
  // Re-export through the API without acceptance is refused.
  expect((await request.post(`/api/exports/${nc.exportId}/reexport`, { data: {} })).status()).toBe(
    428,
  );
  expect(problems).toEqual([]);
});

async function axeClean(page: Page) {
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running'),
  );
  await toastsSettled(page);
  const res = await new AxeBuilder({ page }).analyze();
  const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
  expect(bad.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
}

for (const vp of [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
]) {
  for (const scheme of vp.width > 600 ? (['light', 'dark'] as const) : (['light'] as const)) {
    test(`export step: axe + layout at ${vp.name} ${scheme}`, async ({ page }) => {
      test.setTimeout(180_000);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await openNewProject(page, 'parcalar');
      await pasteAndNest(page);
      await saved(page);
      await goStep(page, 'export');
      await exportNc(page);
      await page.getByTestId('project-status-complete').click();
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.reload();
      await expect(page.getByTestId('project-status-badge')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('export-history-row').first()).toBeAttached();
      await axeClean(page);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
      ).toBe(true);
      await page.screenshot({
        path: `__screenshots__/b37-export-${vp.name}-${scheme}.png`,
        fullPage: vp.width < 600,
      });
      if (vp.width > 600) {
        await expect(page.getByTestId('report-card')).toBeInViewport();
        await expect(page.getByTestId('export-history')).toBeInViewport();
      }
    });
  }
}
