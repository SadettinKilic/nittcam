import { expect, test, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { KITCHEN, goStep, openNewProject, paste } from './wizard-helpers';

// T263 (CTO review #4, D-045): laptop widths. Below 1440 px the workspace steps (board, Dizilim,
// Simülasyon) open with the sidebar as the icon rail; the user's own toggle wins and is
// remembered. The canvases meet the budget; Ayarlar → Malzemeler fits at 1024.

// T378: the stepper's own full-width row costs ~45 px of height (budgets lowered by that much).
const BUDGET = {
  1280: { board: [640, 480], layout: [640, 480], sim: [640, 340] },
  1024: { board: [580, 430], layout: [580, 430], sim: [580, 260] },
} as const;
const HEIGHT = { 1280: 800, 1024: 768 } as const;

type Size = { w: number; h: number };

async function size(el: Locator): Promise<Size> {
  const b = await el.boundingBox();
  if (!b) throw new Error('no box');
  return { w: Math.round(b.width), h: Math.round(b.height) };
}

async function sidebarWidth(page: Page): Promise<number> {
  // Wait for the width transition to finish before reading it.
  const aside = page.getByTestId('shell-sidebar');
  let last = -1;
  await expect(async () => {
    const w = (await size(aside)).w;
    const same = w === last;
    last = w;
    expect(same).toBe(true);
  }).toPass({ intervals: [150, 150, 300], timeout: 5_000 });
  return last;
}

async function measure(page: Page): Promise<Record<'board' | 'layout' | 'sim', Size>> {
  await goStep(page, 'parcalar');
  await page.getByTestId('parts-view-drawing').click();
  const board = page.getByTestId('editor-canvas');
  await expect(board).toHaveAttribute('data-view', /\d/);
  await sidebarWidth(page);
  const b = await size(board);
  await page.getByTestId('parts-view-list').click();
  await goStep(page, 'dizilim');
  const layout = page.getByTestId('layout-canvas');
  await expect(layout).toBeVisible({ timeout: 20_000 });
  await sidebarWidth(page);
  const l = await size(layout);
  await goStep(page, 'simulasyon');
  const sim = page.getByTestId('sim-canvas');
  await expect(sim).toBeVisible({ timeout: 30_000 });
  await sidebarWidth(page);
  const out = { board: b, layout: l, sim: await size(sim) };
  console.log(`T263 ${page.viewportSize()?.width}: ${JSON.stringify(out)}`);
  return out;
}

for (const width of [1280, 1024] as const) {
  test(`T263 ${width}: rail on the workspace steps, canvas budget, own toggle remembered`, async ({
    page,
  }, info) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height: HEIGHT[width] });
    await openNewProject(page, 'parcalar');
    // Off the workspace (cut list) the sidebar stays as the user left it: open.
    expect(await sidebarWidth(page)).toBeGreaterThan(200);
    await paste(page, KITCHEN, 5);
    await goStep(page, 'dizilim');
    // Below 1280 the left panel starts collapsed (T241): open it for "Diz", then close it again
    // (the panel state is remembered and the budget is measured with the default layout).
    const left = page.getByTestId('workspace-left');
    const wasClosed = (await left.getAttribute('data-state')) === 'closed';
    if (wasClosed) await page.getByTestId('workspace-left-toggle').click();
    await left.getByRole('button', { name: tr.cutList.nesting.run, exact: true }).click();
    if (wasClosed) await page.getByTestId('workspace-left-toggle').click();
    await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
    expect(await sidebarWidth(page)).toBe(64);

    const rail = await measure(page);
    expect(await sidebarWidth(page)).toBe(64);
    if (width === 1280) {
      const header = await size(page.getByTestId('wizard-head-row'));
      info.annotations.push({ type: 'header', description: `${header.w}×${header.h}` });
      // T378: two rows (name + chip + undo/redo, then the full-width stepper).
      expect.soft(header.h).toBeLessThan(110);
    }
    for (const k of ['board', 'layout', 'sim'] as const) {
      const [w, h] = BUDGET[width][k];
      info.annotations.push({ type: `rail ${k}`, description: `${rail[k].w}×${rail[k].h}` });
      expect.soft(rail[k].w, `${k} width`).toBeGreaterThanOrEqual(w);
      expect.soft(rail[k].h, `${k} height`).toBeGreaterThanOrEqual(h);
    }

    // The user's own toggle wins on the workspace and survives a reload.
    await page.getByTestId('sidebar-toggle').click();
    expect(await sidebarWidth(page)).toBe(224);
    const open = await measure(page);
    for (const k of ['board', 'layout', 'sim'] as const) {
      info.annotations.push({ type: `open ${k}`, description: `${open[k].w}×${open[k].h}` });
    }
    await page.reload();
    await expect(page.getByTestId('sim-canvas')).toBeVisible({ timeout: 30_000 });
    expect(await sidebarWidth(page)).toBe(224);
    await page.getByTestId('sidebar-toggle').click();
    await page.reload();
    await expect(page.getByTestId('sim-canvas')).toBeVisible({ timeout: 30_000 });
    expect(await sidebarWidth(page)).toBe(64);
    // Leaving the workspace gives the general choice back (open).
    await goStep(page, 'export');
    expect(await sidebarWidth(page)).toBeGreaterThan(200);
    console.log(width, JSON.stringify(info.annotations));
  });
}

test('T263 1440: workspace steps keep the open sidebar', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await paste(page, KITCHEN, 5);
  await goStep(page, 'dizilim');
  expect(await sidebarWidth(page)).toBe(224);
  await page.reload();
  await expect(page.getByTestId('wizard-step-title')).toHaveAttribute('data-step', 'dizilim');
  expect(await sidebarWidth(page)).toBe(224);
});

test('T263 1024: Ayarlar → Malzemeler has no horizontal scroll, row actions on screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/ayarlar/malzemeler');
  const rows = page.getByTestId('material-row');
  await expect(rows.first()).toBeVisible({ timeout: 20_000 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    const row = await rows.nth(i).boundingBox();
    for (const id of ['material-edit', 'material-remove']) {
      const b = await rows.nth(i).getByTestId(id).boundingBox();
      if (!b || !row) throw new Error('no box');
      expect(b.x + b.width).toBeLessThanOrEqual(Math.min(1024, row.x + row.width));
    }
  }
});
