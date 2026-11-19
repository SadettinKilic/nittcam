import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { goStep, openNewProject, pasteAndNest, pickOption } from './wizard-helpers';

// T249 (D-040): Dizilim and Simülasyon panels II. One toolbar row from 1024 px, the grid as an
// icon toggle, one InspectorRow layout, no repeated chips / prose / developer notes.
const l = tr.layout;

/** Tabs (left) and tools (right) share one row. */
async function expectOneRow(page: Page, strip: string, fit: string) {
  const tabs = await page.getByTestId(strip).boundingBox();
  const tools = await page.getByRole('button', { name: fit, exact: true }).boundingBox();
  if (!tabs || !tools) throw new Error('toolbar not visible');
  expect(tools.y).toBeLessThan(tabs.y + tabs.height);
  expect(tabs.y).toBeLessThan(tools.y + tools.height);
  expect(tools.x).toBeGreaterThan(tabs.x + tabs.width - 1);
}

for (const width of [1440, 1024]) {
  test(`${width}: Dizilim and Simülasyon tabs and tools on one row`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'parcalar');
    await pasteAndNest(page);
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 768 });
    await expect(page.getByTestId('layout-canvas')).toHaveAttribute('data-scale', /[0-9]/);
    await expectOneRow(page, 'sheet-tabs-scroll', l.fit);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await goStep(page, 'simulasyon');
    await expect(page.getByTestId('sim-tabs-scroll')).toBeVisible({ timeout: 20_000 });
    await expectOneRow(page, 'sim-tabs-scroll', tr.simulation.controls.fit);
  });
}

test('Dizilim: grid icon toggle, no repeated chips, prose or developer notes', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page);

  const grid = page.getByRole('button', { name: l.grid, exact: true });
  await expect(grid).toHaveAttribute('aria-pressed', 'false');
  await grid.click();
  await expect(grid).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('checkbox', { name: l.grid })).toHaveCount(0);

  await expect(page.getByTestId('nesting-chips').getByRole('listitem')).toHaveText([
    /^Takım Ø\d+(,\d+)?$/,
  ]);
  await expect(page.getByText(/^Plaka \d+: \d+ parça/)).toHaveCount(0);
  await expect(page.getByText(/Şimdilik üç mod/)).toHaveCount(0);
  await expect(page.getByText(/Artık parça kullanımı/)).toHaveCount(0);
});

test('Dizilim inspector: one-line rows at the default panel width, light and dark', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await openNewProject(page, 'parcalar');
    await pasteAndNest(page);
    await pickOption(page.getByTestId('layout-select'), { index: 1 });
    const info = page.getByTestId('layout-info');
    await expect(info).toBeVisible();
    const keys = ['number', 'name', 'size', 'position', 'rotation', 'locked', 'grain'];
    for (const key of keys) {
      const value = page.getByTestId(`layout-info-${key}`);
      const m = await value.evaluate((el) => {
        const row = el.parentElement as HTMLElement;
        return {
          rowH: row.getBoundingClientRect().height,
          fits: el.scrollWidth <= el.clientWidth + 1,
          text: el.textContent ?? '',
        };
      });
      expect(m.rowH, key).toBeLessThanOrEqual(32.5);
      if (key !== 'name') expect(m.fits, `${key}: ${m.text}`).toBe(true);
    }
    await expect(page.getByTestId('layout-info-size')).toHaveText(/^[\d.]+ × [\d.]+ mm$/);
    await expect(page.getByTestId('layout-info-position')).toHaveText(/^X [\d.]+ · Y [\d.]+ mm$/);
    await page.screenshot({ path: `__screenshots__/t249-inspector-1440-${scheme}.png` });
  }
});
