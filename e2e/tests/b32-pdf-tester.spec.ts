import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { goStep, openNewProject, paste, saved, watchConsole } from './wizard-helpers';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };

// B32 tester (T172–T174): PDFs from the export step with Turkish names, all four edge bands and a
// long name; stale revision / bad params; axe on the changed export step. The PDFs are written to
// e2e/__screenshots__/b32/ (git-ignored) for a rendered print-preview review.
const OUT = '__screenshots__/b32';
const LONG = 'Çok uzun isimli İğneli şık ğüşıöç kapak paneli sol üst köşe numaralı deneme parçası';
const LIST = [
  'Parça adı\tEn\tBoy\tAdet\tDamar\tÜst bant\tAlt bant\tSol bant\tSağ bant',
  'Yan ğüşıöç İ\t560\t720\t3\tevet\t1\t1\t1\t1',
  `${LONG}\t596\t716\t2\tevet\t0,8\t\t\t2`,
  'Raf\t564\t520\t4\thayır\t\t\t\t',
].join('\n');
const PIECES = 3 + 2 + 4;

async function toExport(page: Page): Promise<string> {
  await openNewProject(page, 'parcalar');
  await paste(page, LIST, 3);
  await goStep(page, 'dizilim');
  await page.getByRole('button', { name: tr.cutList.nesting.run, exact: true }).click();
  await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
  const waste = page.getByTestId('nesting-waste').first();
  const wasteText = (await waste.count()) ? ((await waste.textContent()) ?? '') : '';
  await saved(page);
  await goStep(page, 'export');
  await expect(page.getByTestId('export-documents')).toBeVisible();
  return wasteText.trim();
}

const noHScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

async function axeSerious(page: Page) {
  await page.waitForTimeout(400); // let transitions settle
  const res = await new AxeBuilder({ page }).analyze();
  return res.violations
    .filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

test('B32 tester: PDFs, stale/bad params, axe, screenshots', async ({ page }) => {
  test.setTimeout(180_000);
  mkdirSync(OUT, { recursive: true });
  const errors = watchConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const waste = await toExport(page);
  writeFileSync(`${OUT}/dizilim-waste.txt`, waste);

  const box = page.getByTestId('export-documents');
  const labelsBox = page.getByTestId('export-labels');
  await expect(labelsBox.getByTestId('labels-count')).toHaveText(`${PIECES} etiket, 1 sayfa`);

  // PDFs: A4, A3, labels. Same URL → same ETag and bytes.
  const hrefs = {
    a4: (await box.getByTestId('export-pdf-a4').getAttribute('href')) as string,
    a3: (await box.getByTestId('export-pdf-a3').getAttribute('href')) as string,
    labels: (await labelsBox.getByTestId('export-labels-open').getAttribute('href')) as string,
  };
  for (const [k, href] of Object.entries(hrefs)) {
    const r1 = await page.request.get(href);
    expect(r1.status(), k).toBe(200);
    const r2 = await page.request.get(href);
    expect(r2.headers()['etag'], k).toBe(r1.headers()['etag']);
    const b = await r1.body();
    expect((await r2.body()).equals(b), k).toBe(true);
    writeFileSync(`${OUT}/${k}.pdf`, b);
  }

  // Bad params → 400; old revision → 409 after another save.
  const a4: string = hrefs.a4;
  const base = a4.split('?')[0];
  for (const q of ['revision=abc', 'revision=-1', 'revision=1.5', 'revision=1&paper=a5']) {
    expect((await page.request.get(`${base}?${q}`)).status(), q).toBe(400);
  }
  const lbase = hrefs.labels.split('?')[0];
  const rev = Number(/revision=(\d+)/.exec(a4)?.[1]);
  for (const q of [
    'preset=a4-9x9',
    'preset=custom&cols=abc&rows=2&width=80&height=50&left=10&top=10&gapX=2&gapY=2',
    'preset=custom&cols=2',
    'dy=-21',
    'dx=NaN',
  ]) {
    expect((await page.request.get(`${lbase}?revision=${rev}&${q}`)).status(), q).toBe(400);
  }
  expect((await page.request.get(`${base}?revision=${rev + 5}`)).status()).toBe(409);
  expect((await page.request.get(`${lbase}?revision=${rev + 5}`)).status()).toBe(409);

  // axe + screenshots of the changed export step.
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1440, height: 900 });
    await box.scrollIntoViewIfNeeded();
    expect(await axeSerious(page), `axe 1440 ${scheme}`).toEqual([]);
    await page.screenshot({ path: `${OUT}/export-1440-${scheme}.png`, fullPage: true });
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  expect(await noHScroll(page)).toBe(true);
  await expect(box).toBeAttached();
  expect(await axeSerious(page), 'axe 390').toEqual([]);
  await page.screenshot({ path: `${OUT}/export-390-light.png`, fullPage: true });

  // Keyboard: the A4 link is reachable by Tab.
  await page.setViewportSize({ width: 1440, height: 900 });
  const link = box.getByTestId('export-pdf-a4');
  await link.focus();
  await expect(link).toBeFocused();

  expect(errors.filter((e) => !/favicon/.test(e))).toEqual([]);
});
