import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { openNewProject, paste, watchConsole } from './wizard-helpers';

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
  // Seeded flat in a row 50 mm apart: nothing near.
  await expect(panel).toHaveAttribute('data-overlaps', '0');
  await expect(panel).toContainText(c.allGood);

  // Taban spans x 0…500 (centre 250); Yan (400 wide) centred at 698 overlaps it by 2 mm.
  await setX(page, 1, '698');
  await expect(panel).toHaveAttribute('data-overlaps', '1');
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
  await expect(panel).toContainText(c.allGood);

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
