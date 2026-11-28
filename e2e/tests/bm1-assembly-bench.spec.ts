import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { openNewProject, paste, saved, watchConsole } from './wizard-helpers';

/**
 * B-M1 T386 / T387: the montaj tezgâhı. Any project (not only cabinets) opens it from the
 * Parçalar step's "Montaj" view; edits are commands (undo/redo), autosaved, and survive a reload.
 */
test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] } });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __nittcamBenchHook: boolean }).__nittcamBenchHook = true;
  });
});

const b = tr.bench;
const PARTS = ['Parça adı\tEn\tBoy\tAdet', 'Taban\t500\t400\t1', 'Yan\t400\t300\t2'].join('\n');

async function openBench(page: Page) {
  await openNewProject(page, 'parcalar');
  await paste(page, PARTS, 2);
  await page.getByTestId('parts-view-assembly').click();
  const bench = page.getByTestId('bench');
  await expect(bench).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await expect(page).toHaveURL(/gorunum=montaj/);
  return bench;
}

async function pointOf(page: Page, id: string, lift = 0): Promise<[number, number]> {
  const p = await page.evaluate(
    ([i, l]) =>
      (
        window as unknown as {
          __nittcamBench?: { point: (id: string, lift: number) => [number, number] | null };
        }
      ).__nittcamBench?.point(i as string, l as number) ?? null,
    [id, lift] as const,
  );
  if (!p) throw new Error(`no point for ${id}`);
  return p;
}

test('every copy is listed; numeric move, 90° turn, hide, undo/redo, reset', async ({ page }) => {
  const errors = watchConsole(page);
  const bench = await openBench(page);
  const rows = page.getByTestId('bench-part');
  await expect(rows).toHaveCount(3);
  await expect(bench).toHaveAttribute('data-shown', '3');
  await expect(bench).toHaveAttribute('data-placed', '0');

  await rows.nth(1).getByRole('button', { pressed: false }).first().click();
  const x = page.getByTestId('bench-pos-x');
  await x.fill('1000');
  await x.press('Enter');
  await expect(bench).toHaveAttribute('data-placed', '1');
  await expect(rows.nth(1)).toContainText(b.list.moved);

  // Lying flat = -90° about X; a 90° turn stands it up (0°).
  const angle = page.getByTestId('bench-angle-x');
  await expect(angle).toHaveValue('-90');
  await page.getByTestId('bench-turn-x').click();
  await expect(angle).toHaveValue('0');

  await page.keyboard.press('Control+z');
  await expect(angle).toHaveValue('-90');
  await page.keyboard.press('Control+y');
  await expect(angle).toHaveValue('0');

  await rows.nth(2).getByTestId('bench-part-eye').click();
  await expect(bench).toHaveAttribute('data-shown', '2');
  await expect(rows.nth(2)).toHaveAttribute('data-hidden', 'true');

  await page.getByTestId('bench-reset-all').click();
  await expect(bench).toHaveAttribute('data-placed', '0');
  await expect(bench).toHaveAttribute('data-shown', '3');
  expect(errors).toEqual([]);
});

test('yüzey yüzeye oturt: B lands flush on A; reload keeps the assembly', async ({ page }) => {
  const bench = await openBench(page);
  await page.getByTestId('bench-view-top').click();
  await expect(bench).toHaveAttribute('data-view', 'top');
  await page.getByTestId('bench-mode-mate').click();
  await expect(page.getByTestId('bench-hint')).toHaveText(b.hints.mateA);

  // Parts lie flat (18 mm), machined face up: A = Taban, B = the first Yan.
  const ids = await page
    .getByTestId('bench-part')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-id') ?? ''));
  const [a, bId] = [ids[0] ?? '', ids[1] ?? ''];
  await expect.poll(async () => (await pointOf(page, a, 9))[0]).toBeGreaterThan(0);
  const pa = await pointOf(page, a, 9);
  await page.mouse.click(pa[0], pa[1]);
  await expect(page.getByTestId('bench-hint')).toHaveText(b.hints.mateB);
  const pb = await pointOf(page, bId, 9);
  await page.mouse.click(pb[0], pb[1]);
  await expect(bench).toHaveAttribute('data-mate', 'slide');
  await expect(bench).toHaveAttribute('data-placed', '1');
  await expect(bench).toHaveAttribute('data-selected', bId);
  // B's top face lies on A's top face (y = 18): B's centre at 18 + 9.
  await expect(page.getByTestId('bench-pos-y')).toHaveValue('27');

  await saved(page);
  await page.reload();
  const again = page.getByTestId('bench');
  await expect(again).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await expect(again).toHaveAttribute('data-placed', '1');
});

test('390 px: the bench opens without a horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openBench(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

/** 300 parts in three shapes (spec §3.8 budget; asserted with PERF_BUDGET=1 on a GPU machine). */
test('300 parts: the bench opens and orbits (frame rate read out)', async ({ page }) => {
  test.slow();
  await openNewProject(page, 'parcalar');
  await paste(
    page,
    [
      'Parça adı\tEn\tBoy\tAdet',
      'Kapak\t150\t100\t100',
      'Çekmece önü\t120\t80\t100',
      'Kulp altlığı\t100\t60\t100',
    ].join('\n'),
    3,
  );
  await page.getByTestId('parts-view-assembly').click();
  const bench = page.getByTestId('bench');
  await expect(bench).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await expect(bench).toHaveAttribute('data-shown', '300');
  const box = await page.getByTestId('bench-canvas').boundingBox();
  if (!box) throw new Error('no canvas');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height * 0.15;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 0; i < 90; i++) await page.mouse.move(cx + Math.sin(i / 20) * 200, cy + 5);
  const fps = Number(await bench.getAttribute('data-fps'));
  await page.mouse.up();
  console.log(
    `[perf] bench 300 parts: orbit ${fps} fps, ${await bench.getAttribute('data-draw-calls')} draw calls`,
  );
  expect(fps).toBeGreaterThan(0);
  if (process.env.PERF_BUDGET === '1') expect(fps).toBeGreaterThanOrEqual(45);
});
