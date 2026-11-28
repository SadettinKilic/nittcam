import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { openNewProject, paste, saved, toastsSettled, watchConsole } from './wizard-helpers';

/** B-M1 tester: owner scenario (5 free parts), pruning, shortcuts, screenshots, axe, 390 smoke. */
test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] } });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __nittcamBenchHook: boolean }).__nittcamBenchHook = true;
  });
});

const FIVE = [
  'Parça adı\tEn\tBoy\tAdet',
  'Taban\t500\t400\t1',
  'Tavan\t500\t400\t1',
  'Yan sol\t400\t300\t1',
  'Yan sağ\t400\t300\t1',
  'Arka\t500\t300\t1',
].join('\n');

async function openBench(page: Page) {
  await openNewProject(page, 'parcalar');
  await paste(page, FIVE, 5);
  await page.getByTestId('parts-view-assembly').click();
  const bench = page.getByTestId('bench');
  await expect(bench).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  return bench;
}

test('owner scenario: 5 free parts, numeric + turn + floor, undo/redo, reload, shortcuts', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = watchConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const bench = await openBench(page);
  const rows = page.getByTestId('bench-part');
  await expect(rows).toHaveCount(5);
  await expect(bench).toHaveAttribute('data-placed', '0');

  await rows.nth(1).click();
  await page.getByTestId('bench-pos-x').fill('1200');
  await page.getByTestId('bench-pos-x').press('Enter');
  await expect(bench).toHaveAttribute('data-placed', '1');
  await page.getByTestId('bench-pos-y').fill('500');
  await page.getByTestId('bench-pos-y').press('Enter');
  await page.getByTestId('bench-floor').click();
  const y = Number(await page.getByTestId('bench-pos-y').inputValue());
  expect(y).toBeGreaterThan(0);
  expect(y).toBeLessThan(500);
  await page.getByTestId('bench-turn-z').click();
  await page.getByTestId('bench-turn-y').click();

  const end = await page.getByTestId('bench-angle-z').inputValue();
  for (let i = 0; i < 5; i++) await page.keyboard.press('Control+z');
  await expect(bench).toHaveAttribute('data-placed', '0');
  for (let i = 0; i < 5; i++) await page.keyboard.press('Control+y');
  await expect(bench).toHaveAttribute('data-placed', '1');
  await rows.nth(1).click();
  await expect(page.getByTestId('bench-angle-z')).toHaveValue(end);

  // Shortcuts do not fire while typing in an input.
  const search = page.getByTestId('bench-search');
  await search.focus();
  await page.keyboard.type('mmwe');
  await expect(search).toHaveValue('mmwe');
  await expect(page.getByTestId('bench-mode-mate')).not.toHaveAttribute('aria-pressed', 'true');
  await search.fill('');
  await page.getByTestId('bench-pos-x').focus();
  await page.keyboard.press('Delete');
  await expect(bench).toHaveAttribute('data-shown', '5');

  await page.getByTestId('bench-canvas').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('?');
  const dialog = page.getByTestId('shortcuts-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(tr.shortcuts.groups.bench);
  await page.keyboard.press('Escape');

  await saved(page);
  await page.reload();
  const again = page.getByTestId('bench');
  await expect(again).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await expect(again).toHaveAttribute('data-placed', '1');
  expect(errors).toEqual([]);
});

test('deleting parts removes their instances in the same undo step', async ({ page }) => {
  test.setTimeout(120_000);
  const bench = await openBench(page);
  const rows = page.getByTestId('bench-part');
  for (const [i, v] of [
    [0, '900'],
    [1, '1300'],
  ] as const) {
    await rows.nth(i).click();
    await page.getByTestId('bench-pos-x').fill(v);
    await page.getByTestId('bench-pos-x').press('Enter');
  }
  await expect(bench).toHaveAttribute('data-placed', '2');
  await page.getByTestId('parts-view-list').click();
  await page.getByTestId('row-select-all').click();
  await page.keyboard.press('Delete');
  await page.getByTestId('parts-view-assembly').click();
  await expect(page.getByTestId('bench')).toBeVisible();
  await expect(page.getByTestId('bench-part')).toHaveCount(0);
  await page.getByTestId('parts-view-list').click();
  await page.keyboard.press('Control+z');
  await page.getByTestId('parts-view-assembly').click();
  await expect(page.getByTestId('bench')).toHaveAttribute('data-ready', 'true', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('bench-part')).toHaveCount(5);
  await expect(page.getByTestId('bench')).toHaveAttribute('data-placed', '2');
});

test('cabinet project: boards seed in the box (nothing stored until moved)', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await page.getByTestId('cabinet-open').click();
  await page.getByTestId('cabinet-add').click();
  await expect(page.getByTestId('cabinet-dialog')).toHaveCount(0);
  await page.getByTestId('parts-view-assembly').click();
  const bench = page.getByTestId('bench');
  await expect(bench).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await expect(bench).toHaveAttribute('data-placed', '0');
  expect(await page.getByTestId('bench-part').count()).toBeGreaterThan(4);
  await page.getByTestId('bench-part').first().click();
  const py = Number(await page.getByTestId('bench-pos-y').inputValue());
  expect(py).toBeGreaterThanOrEqual(0);
  expect(py).toBeLessThan(800);
  expect(Math.abs(Number(await page.getByTestId('bench-pos-x').inputValue()))).toBeLessThan(700);
});

for (const [w, h, theme] of [
  [1440, 900, 'light'],
  [1440, 900, 'dark'],
  [390, 844, 'light'],
] as const) {
  test(`bench @${w} ${theme}: screenshot, axe, no page h-scroll`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: w, height: h });
    await page.emulateMedia({ colorScheme: theme });
    await page.addInitScript((t) => {
      try {
        localStorage.setItem('theme', t);
      } catch {
        /* ignore */
      }
    }, theme);
    const bench = await openBench(page);
    await expect(bench).toBeVisible();
    await toastsSettled(page);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `e2e/__screenshots__/bm1-bench-${w}-${theme}.png` });
    const res = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
    expect(bad.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(over).toBeLessThanOrEqual(1);
  });
}
