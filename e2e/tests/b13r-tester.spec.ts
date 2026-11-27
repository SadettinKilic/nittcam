import { expect, test, type Page, type Route } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { KITCHEN, goStep, openNewProject, pasteAndNest, saved } from './wizard-helpers';

// B13r tester checks (T262, T263) beyond the dev's specs: the "kaydedilince" header while a save is
// pending, the T103 choice coming back after the workspace, the workspace at ≥ 1440 px following
// T103, resize across 1440, the header at 1400–1439 px with a classic (Windows) scrollbar, and
// Malzemeler between 1024 and 1280.

const SHOTS = '__screenshots__';

async function sidebarWidth(page: Page): Promise<number> {
  const aside = page.getByTestId('shell-sidebar');
  let last = -1;
  await expect(async () => {
    const b = await aside.boundingBox();
    const w = Math.round(b?.width ?? -1);
    const same = w === last;
    last = w;
    expect(same).toBe(true);
  }).toPass({ intervals: [150, 150, 300], timeout: 5_000 });
  return last;
}

async function headLines(page: Page): Promise<string[]> {
  return page
    .getByTestId('gcode-panel')
    .locator('button[data-file="0"]')
    .evaluateAll((els) =>
      els
        .map((e) => ({ n: Number(e.getAttribute('data-line')), t: e.getAttribute('data-text') }))
        .sort((a, b) => a.n - b.n)
        .filter((r) => r.n <= 12)
        .map((r) => r.t ?? ''),
    );
}

async function overflowX(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test('T262: panel header shows project name, saved revision, and "kaydedilince" while a save is pending', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page, KITCHEN, 5);
  const name = page.getByLabel(tr.wizard.nameLabel);
  await name.fill('Mutfak alt dolap 60');
  await name.press('Enter');
  await saved(page);
  await goStep(page, 'simulasyon');
  await expect(page.getByTestId('sim-canvas')).toBeVisible({ timeout: 30_000 });
  const rev = await page.getByTestId('save-status').getAttribute('data-revision');
  await expect
    .poll(async () => (await headLines(page)).join('\n'))
    .toContain('Mutfak alt dolap 60');
  await expect
    .poll(async () => (await headLines(page)).join('\n'))
    .toMatch(new RegExp(`\\(REV[İI]ZYON: ${rev}\\)`));
  const fileName = await page.getByTestId('gcode-file').first().getAttribute('data-name');
  expect(fileName).toMatch(/^Mutfak_alt_dolap_60/);
  await page.screenshot({ path: `${SHOTS}/b13r-t262-saved-1440.png` });

  // Hold the next save: the project is dirty, the header must not claim the old revision.
  const held: Route[] = [];
  await page.route('**/api/projects/**', (route) => {
    if (route.request().method() === 'GET') return route.continue();
    held.push(route);
    return undefined;
  });
  await name.fill('Mutfak alt dolap 61');
  await name.press('Enter');
  await expect
    .poll(async () => (await headLines(page)).join('\n'), { timeout: 15_000 })
    .toMatch(/REV[İI]ZYON: kaydedilince/);
  const pending = await headLines(page);
  expect(pending).toHaveLength(12);
  expect(pending.join('\n')).not.toMatch(new RegExp(`REV[İI]ZYON: ${rev}\\b`));
  await page.screenshot({ path: `${SHOTS}/b13r-t262-pending-1440.png` });

  // Release: the header gets the new revision.
  await page.unroute('**/api/projects/**');
  for (const r of held) await r.continue();
  await saved(page);
  const rev2 = await page.getByTestId('save-status').getAttribute('data-revision');
  expect(Number(rev2)).toBeGreaterThan(Number(rev));
  await expect
    .poll(async () => (await headLines(page)).join('\n'), { timeout: 15_000 })
    .toMatch(new RegExp(`\\(REV[İI]ZYON: ${rev2}\\)`));
  expect((await headLines(page)).join('\n')).toContain('Mutfak alt dolap 61');
});

test('T262: a never-saved project shows "kaydedilince"', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/api/projects**', (route) =>
    route.request().method() === 'GET' ? route.continue() : undefined,
  );
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page, KITCHEN, 5);
  await goStep(page, 'simulasyon');
  await expect(page.getByTestId('sim-canvas')).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => (await headLines(page)).join('\n'), { timeout: 15_000 })
    .toMatch(/REV[İI]ZYON: kaydedilince/);
});

test('T263 1280: leaving the workspace restores a collapsed T103 choice; resize across 1440', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/projeler');
  await page.getByTestId('sidebar-toggle').click();
  expect(await sidebarWidth(page)).toBe(64);
  await openNewProject(page, 'parcalar');
  expect(await sidebarWidth(page)).toBe(64);
  await pasteAndNest(page, KITCHEN, 5);
  expect(await sidebarWidth(page)).toBe(64);
  // Own toggle on the workspace: open, remembered separately.
  await page.getByTestId('sidebar-toggle').click();
  expect(await sidebarWidth(page)).toBe(224);
  await goStep(page, 'export');
  expect(await sidebarWidth(page)).toBe(64);
  await page.reload();
  await expect(page.getByTestId('wizard-step-title')).toHaveAttribute('data-step', 'export');
  expect(await sidebarWidth(page)).toBe(64);
  await goStep(page, 'dizilim');
  expect(await sidebarWidth(page)).toBe(224);
  await page.goto('/projeler');
  expect(await sidebarWidth(page)).toBe(64);
  await page.goBack();
  await expect(page.getByTestId('wizard-step-title')).toHaveAttribute('data-step', 'dizilim');
  expect(await sidebarWidth(page)).toBe(224);
  // Close it again on the workspace, then resize across 1440 (T103 = collapsed there).
  await page.getByTestId('sidebar-toggle').click();
  expect(await sidebarWidth(page)).toBe(64);
  await page.setViewportSize({ width: 1500, height: 900 });
  expect(await sidebarWidth(page)).toBe(64);
  // At ≥ 1440 the toggle writes the T103 key: open it, back to 1280 → rail (workspace key).
  await page.getByTestId('sidebar-toggle').click();
  expect(await sidebarWidth(page)).toBe(224);
  await page.setViewportSize({ width: 1280, height: 800 });
  expect(await sidebarWidth(page)).toBe(64);
  await page.setViewportSize({ width: 1500, height: 900 });
  expect(await sidebarWidth(page)).toBe(224);
  expect(await overflowX(page)).toBeLessThanOrEqual(0);
});

test('T263 1440: a collapsed T103 choice also applies on the workspace', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page, KITCHEN, 5);
  expect(await sidebarWidth(page)).toBe(224);
  await page.getByTestId('sidebar-toggle').click();
  expect(await sidebarWidth(page)).toBe(64);
  await goStep(page, 'export');
  expect(await sidebarWidth(page)).toBe(64);
  await page.reload();
  await expect(page.getByTestId('wizard-step-title')).toHaveAttribute('data-step', 'export');
  expect(await sidebarWidth(page)).toBe(64);
});

// Classic scrollbars as on Windows (headless Chromium hides them by default).
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

test.describe('classic scrollbar (Windows)', () => {
  test('T263 1400–1439: header row and no horizontal scroll with a scrollbar', async ({
    page,
  }, info) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width: 1400, height: 900 });
    await openNewProject(page, 'parcalar');
    await pasteAndNest(page, KITCHEN, 5);
    await page.addStyleTag({ content: 'html{overflow-y:scroll !important}' });
    const sb = await page.evaluate(() => window.innerWidth - document.documentElement.clientWidth);
    info.annotations.push({ type: 'scrollbar', description: `${sb}px` });
    for (const step of ['dizilim', 'simulasyon', 'export', 'makine'] as const) {
      await goStep(page, step);
      await page.addStyleTag({ content: 'html{overflow-y:scroll !important}' });
      for (const w of [1400, 1410, 1420, 1439, 1440, 1460, 1280]) {
        await page.setViewportSize({ width: w, height: 900 });
        const side = await sidebarWidth(page);
        const head = await page.getByTestId('wizard-head-row').boundingBox();
        const h = Math.round(head?.height ?? -1);
        info.annotations.push({
          type: `${step} ${w}`,
          description: `sidebar ${side}, head h ${h}`,
        });
        expect.soft(await overflowX(page), `${step} ${w} overflow`).toBeLessThanOrEqual(0);
        if (step === 'dizilim' || step === 'simulasyon') {
          // T378: two rows (name row + full-width stepper row).
          expect.soft(h, `${step} ${w} header two rows`).toBeLessThan(110);
        }
        if (step === 'simulasyon' && (w === 1410 || w === 1280))
          await page.screenshot({ path: `${SHOTS}/b13r-t263-sim-${w}-scrollbar.png` });
      }
      await page.setViewportSize({ width: 1400, height: 900 });
    }
    console.log(JSON.stringify(info.annotations));
  });
});

test('T263: Malzemeler 1024–1440 no horizontal scroll, actions visible (light + dark shots)', async ({
  page,
}) => {
  test.setTimeout(60_000);
  for (const w of [1024, 1100, 1279, 1280, 1366, 1440]) {
    await page.setViewportSize({ width: w, height: 768 });
    await page.goto('/ayarlar/malzemeler');
    const rows = page.getByTestId('material-row');
    await expect(rows.first()).toBeVisible({ timeout: 20_000 });
    expect.soft(await overflowX(page), `${w} overflow`).toBeLessThanOrEqual(0);
    const n = await rows.count();
    for (let i = 0; i < n; i++) {
      for (const id of ['material-edit', 'material-remove']) {
        const b = await rows.nth(i).getByTestId(id).boundingBox();
        expect.soft(b && b.x + b.width <= w, `${w} row ${i} ${id}`).toBe(true);
      }
    }
    if (w === 1024 || w === 1280) {
      await page.screenshot({
        path: `${SHOTS}/b13r-t263-materials-${w}-light.png`,
        fullPage: true,
      });
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.screenshot({ path: `${SHOTS}/b13r-t263-materials-${w}-dark.png`, fullPage: true });
      await page.emulateMedia({ colorScheme: 'light' });
    }
  }
});
