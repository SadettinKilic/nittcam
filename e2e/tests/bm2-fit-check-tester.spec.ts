import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { goStep, openNewProject, paste, pasteAndNest, saved, watchConsole } from './wizard-helpers';

/** B-M2 tester: dowel holes, face-to-face + fit, PDF page, screenshots, axe, 390 smoke. */
test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] } });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __nittcamBenchHook: boolean }).__nittcamBenchHook = true;
  });
});

const c = tr.bench.check;
const PARTS = ['Parça adı\tEn\tBoy\tAdet', 'Taban\t500\t400\t1', 'Yan\t400\t300\t1'].join('\n');
const trNum = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

async function openBench(page: Page) {
  await openNewProject(page, 'parcalar');
  await paste(page, PARTS, 2);
  await page.getByTestId('parts-view-assembly').click();
  const bench = page.getByTestId('bench');
  await expect(bench).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  return bench;
}
async function setF(page: Page, row: number, axis: 'x' | 'y' | 'z', v: string) {
  await page.getByTestId('bench-part').nth(row).getByRole('button').first().click();
  const f = page.getByTestId(`bench-pos-${axis}`);
  await f.fill(v);
  await f.press('Enter');
}
/** One Ø8 hole drawn with the hole tool, then its centre typed exact. */
async function centreHole(page: Page, row: number, cx: number, cy: number) {
  await page.getByTestId('parts-view-drawing').click();
  const canvas = page.getByTestId('editor-canvas');
  await expect(canvas).toHaveAttribute('data-view', /\d/);
  const show = page.getByRole('button', { name: 'Parça listesini göster' });
  if (await show.isVisible()) await show.click();
  await page.getByTestId('editor-part-list').getByRole('button').nth(row).click();
  const pos = (await page.getByTestId('editor-position').textContent()) ?? '';
  const m = /X\s*(-?[\d.,]+)\s*·\s*Y\s*(-?[\d.,]+)/.exec(pos);
  const [scale = 0, vx = 0, vy = 0] = ((await canvas.getAttribute('data-view')) ?? '')
    .split(',')
    .map(Number);
  const box = await canvas.boundingBox();
  if (!box || !m) throw new Error('no canvas');
  const px = trNum(m[1] ?? '0') + cx;
  const py = trNum(m[2] ?? '0') + cy;
  await canvas.focus();
  await page.keyboard.press('o');
  const sx = box.x + px * scale + vx;
  const sy = box.y + vy - py * scale;
  await page.mouse.click(sx, sy);
  await page.mouse.move(sx + 10, sy + 3, { steps: 2 });
  await page.keyboard.type('8');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await page.getByTestId('editor-part-list').getByRole('button').nth(row).click();
  await page.getByTestId('prop-hole-0-cx').fill(String(cx));
  await page.getByTestId('prop-hole-0-cx').press('Enter');
  await page.getByTestId('prop-hole-0-cy').fill(String(cy));
  await page.getByTestId('prop-hole-0-cy').press('Enter');
  await expect(page.getByTestId('prop-hole-0-cx')).toHaveValue(String(cx));
}

test('dowel holes: aligned green, 0,5 mm off orange with offset; 2 mm sink overlaps', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = watchConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await paste(page, PARTS, 2);
  await centreHole(page, 0, 250, 200);
  await centreHole(page, 1, 200, 150);
  await page.getByTestId('parts-view-assembly').click();
  const bench = page.getByTestId('bench');
  await expect(bench).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });

  // Yan lies on Taban's top face, centres on one vertical line: holes coincide.
  await setF(page, 1, 'x', '250');
  await setF(page, 1, 'z', '200');
  await setF(page, 1, 'y', '27');
  await page.getByTestId('bench-check-toggle').click();
  const panel = page.getByTestId('bench-check');
  await expect(bench).toHaveAttribute('data-check', 'done');
  await expect(panel).toHaveAttribute('data-overlaps', '0');
  await page.screenshot({ path: 'e2e/__screenshots__/bm2-holes-green.png' });
  console.log('ALIGNED:', (await panel.innerText()).replace(/\n/g, ' | '));

  await setF(page, 1, 'x', '250,5');
  await expect(bench).toHaveAttribute('data-check', 'done');
  console.log('OFF:', (await panel.innerText()).replace(/\n/g, ' | '));
  await expect(panel).toContainText('0,5');
  await page.screenshot({ path: 'e2e/__screenshots__/bm2-holes-orange.png' });
  await page.getByTestId('bench-check-row').first().click();
  await expect(panel).not.toContainText(c.allGood);

  // Back in place, then a 2 mm sink: overlap with depth about 2.
  await setF(page, 1, 'x', '250');
  await setF(page, 1, 'y', '25');
  await expect(panel).toHaveAttribute('data-overlaps', '1');
  await expect(page.getByTestId('bench-check-row').first()).toContainText('2 mm');
  expect(errors).toEqual([]);
});

test('face-to-face mate (M) then the check reads a fit', async ({ page }) => {
  test.setTimeout(120_000);
  const bench = await openBench(page);
  await page.getByTestId('bench-view-top').click();
  const ids = await page
    .getByTestId('bench-part')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-id') ?? ''));
  const pt = (id: string) =>
    page.evaluate(
      (i) =>
        (
          window as unknown as {
            __nittcamBench?: { point: (id: string, lift: number) => [number, number] | null };
          }
        ).__nittcamBench?.point(i, 9) ?? null,
      id,
    );
  await expect.poll(async () => (await pt(ids[0] ?? ''))?.[0] ?? 0).toBeGreaterThan(0);
  const a = await pt(ids[0] ?? '');
  const b = await pt(ids[1] ?? '');
  if (!a || !b) throw new Error('no points');
  await page.keyboard.press('m');
  await expect(page.getByTestId('bench-hint')).toHaveText(tr.bench.hints.mateA);
  await page.mouse.click(a[0], a[1]);
  await page.mouse.click(b[0], b[1]);
  await expect(bench).toHaveAttribute('data-mate', 'slide');
  await page.getByTestId('bench-check-toggle').click();
  await expect(bench).toHaveAttribute('data-check', 'done');
  await expect(page.getByTestId('bench-check')).toHaveAttribute('data-overlaps', '0');
});

test('screens: bench + panel 1440 light/dark, 390 smoke, axe', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const bench = await openBench(page);
  await setF(page, 1, 'x', '698');
  await page.getByTestId('bench-check-toggle').click();
  await expect(bench).toHaveAttribute('data-check', 'done');
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `e2e/__screenshots__/bm2-bench-1440-${scheme}.png` });
    const axe = await new AxeBuilder({ page }).analyze();
    const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => v.id)).toEqual([]);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'e2e/__screenshots__/bm2-bench-390-dark.png' });
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(over).toBeLessThanOrEqual(1);
});

test('Montaj föyü: PDF gets one more page; off = bytes unchanged', async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page);
  await saved(page);
  const pdfHref = async () => {
    await goStep(page, 'export');
    return (await page.getByTestId('export-pdf-a4').getAttribute('href')) ?? '';
  };
  const get = async (h: string) => (await page.request.get(h)).body();
  const before = await get(await pdfHref());
  const req = createRequire(`${process.cwd()}/apps/web/package.json`);
  const { PDFDocument } = req('pdf-lib') as {
    PDFDocument: { load: (b: Buffer) => Promise<{ getPageCount: () => number }> };
  };
  const pages = async (b: Buffer) => (await PDFDocument.load(b)).getPageCount();
  const n0 = await pages(before);
  const toggle = async () => {
    await goStep(page, 'parcalar');
    await page.getByTestId('parts-view-assembly').click();
    await expect(page.getByTestId('bench')).toHaveAttribute('data-ready', 'true', {
      timeout: 30_000,
    });
    await page.getByTestId('bench-sheet').click();
    await saved(page);
  };

  await toggle();
  const on = await get(await pdfHref());
  expect(await pages(on)).toBe(n0 + 1);
  mkdirSync('e2e/__screenshots__', { recursive: true });
  writeFileSync('e2e/__screenshots__/bm2-sheet-on.pdf', on);
  writeFileSync('e2e/__screenshots__/bm2-sheet-off.pdf', before);

  await toggle();
  const off = await get(await pdfHref());
  expect(await pages(off)).toBe(n0);
  // Not byte-equal to the first PDF only because the footer carries the revision number (1 vs 3):
  // same page count, same size within a few bytes, no sheet page.
  expect(Math.abs(off.length - before.length)).toBeLessThan(64);
});
