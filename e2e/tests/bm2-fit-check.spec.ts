import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { openNewProject, paste, saved, watchConsole } from './wizard-helpers';

/**
 * B-M2 T388: "Oturuyor mu?" on the montaj tezgâhı. Two panels overlapping by 2 mm turn red with
 * the depth; a 0,6 mm gap is listed; touching is a fit. Display only.
 */
test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] } });

const c = tr.bench.check;
const PARTS = ['Parça adı\tEn\tBoy\tAdet', 'Taban\t500\t400\t1', 'Yan\t400\t300\t2'].join('\n');

async function openBench(page: Page) {
  await openNewProject(page, 'parcalar');
  await paste(page, PARTS, 2);
  await page.getByTestId('parts-view-assembly').click();
  const bench = page.getByTestId('bench');
  await expect(bench).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  return bench;
}

async function setX(page: Page, row: number, x: string) {
  // The row's first button selects it (pressed once selected; the others hide / isolate).
  await page.getByTestId('bench-part').nth(row).getByRole('button').first().click();
  const f = page.getByTestId('bench-pos-x');
  await f.fill(x);
  await f.press('Enter');
}

test('overlap 2 mm red with depth, 0,6 mm gap listed, touching fits', async ({ page }) => {
  const errors = watchConsole(page);
  const bench = await openBench(page);
  await page.getByTestId('bench-check-toggle').click();
  const panel = page.getByTestId('bench-check');
  await expect(bench).toHaveAttribute('data-check', 'done');
  // Seeded flat in a row 50 mm apart: nothing near, so every part is listed as touching nothing
  // (T397, CTO #14 P5: never "Her şey oturuyor" while a shown part is loose).
  await expect(panel).toHaveAttribute('data-overlaps', '0');
  await expect(panel).toHaveAttribute('data-loose', '3');
  await expect(panel).not.toContainText(c.allGood);

  // Taban spans x 0…500 (centre 250); Yan (400 wide) centred at 698 overlaps it by 2 mm.
  await setX(page, 1, '698');
  await expect(panel).toHaveAttribute('data-overlaps', '1');
  // T397 (CTO #14 P7): the results float over the canvas; the position fields stay in view.
  await expect(page.getByTestId('bench-pos-x')).toBeInViewport();
  const row = page.getByTestId('bench-check-row').first();
  await expect(row).toHaveAttribute('data-kind', 'overlap');
  await expect(row).toContainText('2 mm çakışıyor');
  await row.click(); // frames the pair (camera only)

  await setX(page, 1, '700,6');
  await expect(panel).toHaveAttribute('data-overlaps', '0');
  await expect(panel).toHaveAttribute('data-gaps', '1');
  await expect(page.getByTestId('bench-check-row').first()).toContainText('boşluk 0,6 mm');

  await setX(page, 1, '700');
  await expect(panel).toHaveAttribute('data-gaps', '0');
  await expect(panel).toHaveAttribute('data-touching', '1');
  // The second Yan still touches nothing: an info row, no "Her şey oturuyor".
  await expect(panel).toHaveAttribute('data-loose', '1');
  await expect(page.getByTestId('bench-check-row').last()).toHaveText(
    c.loose.replace('{name}', 'Yan (2. adet)'),
  );
  await expect(panel).not.toContainText(c.allGood);

  await page.getByTestId('bench-check-close').click();
  await expect(panel).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('an empty bench is ready at once (B-M1 tester note)', async ({ page }) => {
  await openNewProject(page, 'parcalar');
  await page.getByTestId('parts-view-assembly').click();
  await expect(page.getByTestId('bench')).toHaveAttribute('data-ready', 'true');
  await expect(page.getByTestId('bench')).toContainText(tr.bench.empty);
});

test('explode and section are display only (T389)', async ({ page }) => {
  const errors = watchConsole(page);
  const bench = await openBench(page);
  await setX(page, 1, '700');
  const x = page.getByTestId('bench-pos-x');
  await expect(x).toHaveValue('700');

  const thumb = page.getByTestId('bench-explode').getByRole('slider');
  await thumb.focus();
  await thumb.press('End');
  await expect(bench).toHaveAttribute('data-explode', '100');
  await expect(page.getByTestId('bench-tools')).toContainText(tr.bench.tools.locked);
  // T397 (CTO #14 P6): Taşı / Döndür / Oturt are off while exploded, with the reason as the hint;
  // a click does not start a mate; Ölç stays available.
  for (const m of ['move', 'rotate', 'mate']) {
    await expect(page.getByTestId('bench-mode-' + m)).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByTestId('bench-mode-' + m)).toHaveAttribute('aria-checked', 'false');
  }
  await expect(page.getByTestId('bench-mode-measure')).not.toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId('bench-hint')).toHaveText(tr.bench.tools.locked);
  await page.getByTestId('bench-mode-mate').click({ force: true });
  await expect(bench).toHaveAttribute('data-mode', 'move');
  // The stored place does not change; the bench still counts one moved part.
  await expect(x).toHaveValue('700');
  await expect(bench).toHaveAttribute('data-placed', '1');
  await thumb.press('Home');
  await expect(bench).toHaveAttribute('data-explode', '0');
  // Back at 0 %: the tool chosen before (Taşı) is active again.
  await expect(page.getByTestId('bench-mode-move')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('bench-mode-move')).not.toHaveAttribute('aria-disabled', 'true');

  await page.getByTestId('bench-section-y').click();
  await expect(bench).toHaveAttribute('data-section', /^y:\d+$/);
  const cut = page.getByTestId('bench-section-at').getByRole('slider');
  await cut.focus();
  await cut.press('Home');
  await expect(bench).toHaveAttribute('data-section', /^y:-?\d+$/);
  await page.getByTestId('bench-section-flip').click();
  await expect(bench).toHaveAttribute('data-section', /:flip$/);
  await page.getByTestId('bench-section-off').click();
  await expect(bench).toHaveAttribute('data-section', '');
  expect(errors).toEqual([]);
});

test('measure: two face points, distance and face gap (T389)', async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __nittcamBenchHook: boolean }).__nittcamBenchHook = true;
  });
  const errors = watchConsole(page);
  const bench = await openBench(page);
  const ids = await page
    .getByTestId('bench-part')
    .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-id') ?? ''));
  const point = async (id: string) => {
    const p = await page.evaluate(
      (i) =>
        (
          window as unknown as {
            __nittcamBench?: { point: (id: string, lift: number) => [number, number] | null };
          }
        ).__nittcamBench?.point(i, 9) ?? null,
      id,
    );
    if (!p) throw new Error(`no point for ${id}`);
    return p;
  };
  await page.getByTestId('bench-mode-measure').click();
  await expect(page.getByTestId('bench-hint')).toHaveText(tr.bench.hints.measureA);
  const [ax, ay] = await point(ids[0] ?? '');
  await page.mouse.click(ax, ay);
  await expect(page.getByTestId('bench-hint')).toHaveText(tr.bench.hints.measureB);
  const [bx, by] = await point(ids[1] ?? '');
  await page.mouse.click(bx, by);
  // Taban's top centre (250, 18, 200) to Yan's (750, 18, 150): √(500² + 50²) ≈ 502,5 mm.
  await expect(bench).toHaveAttribute('data-picks', 'face,face');
  const d = Number(await bench.getAttribute('data-measure'));
  expect(Math.abs(d - 502.49)).toBeLessThan(3);
  await expect(bench).toHaveAttribute('data-face-gap', '0.00');
  await expect(page.getByTestId('bench-hint')).toContainText('Yüzeyler arası 0 mm');
  await page.keyboard.press('Escape');
  await expect(bench).toHaveAttribute('data-picks', '');
  expect(errors).toEqual([]);
});

test('Montaj föyü switch is stored with the project and undoable (T389)', async ({ page }) => {
  const errors = watchConsole(page);
  await openBench(page);
  const sw = page.getByTestId('bench-sheet');
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await saved(page);
  await page.reload();
  await expect(page.getByTestId('bench')).toHaveAttribute('data-ready', 'true', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('bench-sheet')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('bench-sheet').click();
  await expect(page.getByTestId('bench-sheet')).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('bench-sheet')).toHaveAttribute('aria-checked', 'true');
  expect(errors).toEqual([]);
});
