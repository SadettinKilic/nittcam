import { expect, test, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { goStep, KITCHEN_3, openNewProject, openWorkspacePanel, paste } from './wizard-helpers';

// B67 polish riders (testers 2026-11-28): bench toolbar at 1440, the paste toast clears the bench
// toolbar, every Dizilim plate tab reachable at 1024, one-line spacing hints at 1440.
test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] } });

const SHOTS = process.env.B67_SHOTS;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

async function bb(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error('no box');
  return b;
}

const PARTS = ['Parça adı\tEn\tBoy\tAdet', 'Taban\t500\t400\t1', 'Yan\t400\t300\t2'].join('\n');

test('bench 1440: "Oturuyor mu?" clear of the zoom group; the paste toast below the toolbar', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await paste(page, PARTS, 2);
  await page.getByTestId('parts-view-assembly').click();
  await expect(page.getByTestId('bench')).toHaveAttribute('data-ready', 'true', {
    timeout: 30_000,
  });
  const check = page.getByTestId('bench-check-toggle');
  await expect(check).toContainText(tr.bench.check.button);
  const c = await bb(check);
  const z = await bb(page.getByTestId('bench-zoom'));
  const apart = c.x + c.width <= z.x || c.y >= z.y + z.height || c.y + c.height <= z.y;
  expect(apart, JSON.stringify({ c, z })).toBe(true);
  expect(await check.evaluate((e) => e.scrollWidth <= e.clientWidth + 1)).toBe(true);
  const toast = page.locator('[data-sonner-toast]').first();
  if (await toast.isVisible()) {
    const t = await bb(toast);
    const bar = await bb(page.getByTestId('bench-toolbar'));
    await shot(page, 'bench-1440-toast');
    expect(t.y).toBeGreaterThanOrEqual(Math.max(bar.y + bar.height, z.y + z.height));
  }
  await shot(page, 'bench-1440');
});

test('Dizilim 1024: every plate tab can be reached and shown whole', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1024, height: 768 });
  await openNewProject(page, 'parcalar');
  await paste(page, KITCHEN_3, 5);
  await goStep(page, 'dizilim');
  const strip = page.getByTestId('sheet-tabs-scroll');
  const tabs = strip.getByRole('tab');
  await expect(tabs).toHaveCount(4, { timeout: 30_000 });
  await shot(page, 'dizilim-1024');
  // A clipped end shows an arrow; clicking it pages until the last tab is whole.
  const next = page.getByTestId('sheet-tabs-scroll-next');
  await expect(next).toBeVisible();
  for (let i = 0; i < 5 && (await next.isVisible()); i++) {
    await next.click();
    await page.waitForTimeout(400);
  }
  await expect(next).toHaveCount(0);
  await expect(page.getByTestId('sheet-tabs-scroll-prev')).toBeVisible();
  const last = tabs.last();
  const s = await bb(strip);
  const l = await bb(last);
  expect(l.x).toBeGreaterThanOrEqual(s.x - 1);
  expect(l.x + l.width).toBeLessThanOrEqual(s.x + s.width + 1);
  await shot(page, 'dizilim-1024-last');
});

test('Dizilim 1440: each spacing hint fits on one line', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await paste(page, 'Ad\tEn\tBoy\tAdet\nYan\t560\t720\t1', 1);
  await goStep(page, 'dizilim');
  await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
  const panel = await openWorkspacePanel(page, 'left');
  await shot(page, 'dizilim-1440');
  for (const id of ['layout-gap-note', 'layout-margin-hint']) {
    const el = panel.getByTestId(id);
    const lh = await el.evaluate((e) => Number.parseFloat(getComputedStyle(e).lineHeight) || 16);
    expect((await bb(el)).height, id).toBeLessThanOrEqual(lh * 1.5);
  }
  await shot(page, 'dizilim-1440');
});
