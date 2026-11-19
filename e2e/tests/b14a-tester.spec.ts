import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  fill,
  goStep,
  nest,
  openNewProject,
  paste,
  projectId,
  saved,
  wizardReady,
} from './wizard-helpers';

// B14a tester. T274: on the seeded Mach3 machine (manual changer, no length offset) a program
// with T1 and T2 holes lists every tool in order of use, asks for the manual-change confirmation
// (İndir stays disabled without it) and Simülasyon shows the same order and count.
// T275: a groove narrower than the tool is an error under its row; "Takım no" shows "· Ø8" or
// "· yok"; the hole panel at 1024.

async function setHoles(request: APIRequestContext, id: string, holes: unknown[]) {
  const cur = (await (await request.get(`/api/projects/${id}`)).json()) as {
    revision: number;
    project: { parts: { name: string; holes: unknown[] }[] };
  };
  const part = cur.project.parts.find((p) => p.name === 'Kapak');
  if (!part) throw new Error('no Kapak');
  part.holes = holes;
  const res = await request.put(`/api/projects/${id}`, {
    data: { project: cur.project, baseRevision: cur.revision, commands: [] },
  });
  expect(res.status()).toBe(200);
}

async function axeClean(page: Page) {
  const res = await new AxeBuilder({ page }).analyze();
  const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
}

async function kapak(
  page: Page,
  request: APIRequestContext,
  holes: unknown[],
  width = 1440,
  nested = true,
) {
  await page.setViewportSize({ width, height: 900 });
  await openNewProject(page, 'parcalar');
  await paste(page, 'Ad\tEn\tBoy\tAdet\nKapak\t596\t716\t1', 1);
  await saved(page);
  const id = await projectId(page);
  await setHoles(request, id, holes);
  await page.goto(`/projeler/${id}?adim=parcalar`);
  await wizardReady(page, 'parcalar');
  if (nested) {
    await nest(page);
    await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
    await saved(page);
  }
  return id;
}

test('T274: two tools on a manual changer: order, re-zero confirmation gates İndir, Simülasyon agrees', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await kapak(page, request, [
    { id: 'h1', type: 'through', d: 20, cx: 150, cy: 150, tool: 1 },
    { id: 'h2', type: 'through', d: 35, cx: 300, cy: 300, tool: 2 },
  ]);

  await goStep(page, 'simulasyon');
  const order = page.getByTestId('sim-tool-order');
  await expect(order).toBeVisible({ timeout: 30_000 });
  const orderText = (await order.textContent()) ?? '';
  const runs = orderText.replace(/^.*?:\s*/, '').split(' → ');
  expect(runs.length).toBeGreaterThanOrEqual(2);
  expect(new Set(runs)).toEqual(new Set(['T1 Ø6 mm', 'T2 Ø8 mm']));
  const changes = runs.length - 1;
  await expect(page.getByTestId('sim-manual-change')).toHaveText(
    fill(tr.simulation.summary.manualChangeZ, { count: changes }),
  );
  await expect(page.getByTestId('sim-summary-tools')).toContainText(String(changes));
  await axeClean(page);

  await goStep(page, 'export');
  await expect(page.getByTestId('export-status')).toHaveAttribute('data-ok', 'true', {
    timeout: 30_000,
  });
  const w = tr.wizard.export;
  await expect(page.getByTestId('export-check-tool').locator('..')).toContainText(runs.join(' → '));
  const change = page.getByTestId('export-check-toolchange');
  await expect(change.locator('..')).toContainText(fill(w.checkToolChangeZ, { count: changes }));
  const download = page.getByTestId('export-download');
  await page.getByTestId('export-check-origin').check();
  await page.getByTestId('export-check-tool').check();
  await page.getByTestId('export-check-aircut').check();
  await expect(download).toBeDisabled();
  await expect(page.getByTestId('export-hint')).toHaveText(w.needChecks);
  await change.check();
  await expect(page.getByTestId('export-hint')).not.toHaveText(w.needChecks);
  await page.screenshot({ path: '__screenshots__/b14a-export-1440.png', fullPage: true });
  await axeClean(page);
});

test('T274: one tool on the manual changer: no change line, Simülasyon counts 0 changes', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await kapak(page, request, [{ id: 'h1', type: 'through', d: 35, cx: 300, cy: 300, tool: 2 }]);
  await goStep(page, 'simulasyon');
  await expect(page.getByTestId('sim-summary')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('sim-manual-change')).toHaveCount(0);
  await expect(page.getByTestId('sim-tool-order')).toHaveCount(0);
  await goStep(page, 'export');
  await expect(page.getByTestId('export-status')).toHaveAttribute('data-ok', 'true', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('export-check-toolchange')).toHaveCount(0);
  await expect(page.getByTestId('export-check-tool').locator('..')).toContainText('T2 Ø8 mm');
});

test('T275: groove narrower than the tool is an error; Takım no shows Ø or yok; 1024', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await kapak(
    page,
    request,
    [
      { id: 'g1', type: 'groove', d: 60, grooveWidth: 5, depth: 3, cx: 200, cy: 200, tool: 2 },
      { id: 'h2', type: 'through', d: 10, cx: 400, cy: 400, tool: 9 },
    ],
    1024,
    false,
  );
  await expect(page.getByTestId('wizard-step-parcalar')).toHaveAttribute('data-error', '');
  await page.getByTestId('cut-list-issue-chip').click();
  await expect(
    page.getByTestId('validation-panel').locator('[data-code="GROOVE_NARROWER_THAN_TOOL"]'),
  ).toContainText(fill(tr.wizard.issues.holeNamed, { name: 'Kapak', k: 1 }));
  await page.keyboard.press('Escape');

  await goStep(page, 'dizilim');
  await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
  await goStep(page, 'simulasyon');
  await expect(page.getByTestId('sim-blocked')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('violation-open-part').first().click();
  await wizardReady(page, 'parcalar');
  await expect(page).toHaveURL(/gorunum=cizim/);
  await expect(page.getByTestId('prop-hole-0')).toHaveAttribute(
    'data-error',
    'GROOVE_NARROWER_THAN_TOOL',
  );
  await expect(page.getByTestId('prop-hole-0')).toContainText(
    fill(tr.editor.inspector.hole.toolDiameter, { d: '8' }),
  );
  await expect(page.getByTestId('prop-hole-1')).toContainText(tr.editor.inspector.hole.toolMissing);
  await page.screenshot({ path: '__screenshots__/b14a-holes-1024.png', fullPage: true });
  await axeClean(page);
  const scroll = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(scroll).toBeLessThanOrEqual(0);
});

// T276 at %100: zoomed in at the hinge position with the wheel, a Ø35 cup 22,5 mm from the edge
// lands on the nearest grid point inside the part and is accepted.
test('T276: hinge cup 22,5 mm from the edge at %100 lands where clicked', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await paste(page, 'Ad\tEn\tBoy\tAdet\nKapak\t596\t716\t1', 1);
  await page.getByTestId('parts-view-drawing').click();
  const canvas = page.getByTestId('editor-canvas');
  await expect(canvas).toHaveAttribute('data-view', /\d/);
  const trNum = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));
  const show = page.getByRole('button', { name: 'Parça listesini göster' });
  if (await show.isVisible()) await show.click();
  await page.getByTestId('editor-part-list').getByRole('button').first().click();
  const pos = (await page.getByTestId('editor-position').textContent()) ?? '';
  const m = /X\s*(-?[\d.,]+)\s*·\s*Y\s*(-?[\d.,]+)/.exec(pos);
  const part = { x: trNum(m?.[1] ?? 'NaN'), y: trNum(m?.[2] ?? 'NaN') };
  const screen = async (p: { x: number; y: number }) => {
    const [scale = 0, vx = 0, vy = 0] = ((await canvas.getAttribute('data-view')) ?? '')
      .split(',')
      .map(Number);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('no canvas box');
    return { x: box.x + p.x * scale + vx, y: box.y + vy - p.y * scale, scale };
  };
  const target = { x: part.x + 22.5, y: part.y + 100 };
  const zoom = page.getByTestId('editor-zoom');
  for (let i = 0; i < 40; i++) {
    const pct = Number(((await zoom.textContent()) ?? '%0').replace(/[^\d]/g, ''));
    if (pct >= 100) break;
    const at = await screen(target);
    await page.mouse.move(at.x, at.y);
    await page.mouse.wheel(0, -120);
  }
  const pct = Number(((await zoom.textContent()) ?? '%0').replace(/[^\d]/g, ''));
  expect(pct).toBeGreaterThanOrEqual(100);
  await canvas.focus();
  await page.keyboard.press('o');
  const at = await screen(target);
  await page.mouse.click(at.x, at.y);
  await page.mouse.move(at.x + 10, at.y + 3, { steps: 2 });
  await page.keyboard.type('35');
  await page.keyboard.press('Enter');
  await expect(page.getByText(tr.editor.holeEdge)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  if (await show.isVisible()) await show.click();
  await page.getByTestId('editor-part-list').getByRole('button').first().click();
  const cx = trNum(await page.getByTestId('prop-hole-0-cx').inputValue());
  const cy = trNum(await page.getByTestId('prop-hole-0-cy').inputValue());
  // at %100 the 5 mm grid point inside the part wins (snap on): within half a grid step
  expect(Math.abs(cx - 22.5)).toBeLessThanOrEqual(2.5);
  expect(Math.abs(cy - 100)).toBeLessThanOrEqual(2.5);
  await expect(page.getByTestId('prop-hole-0-d')).toHaveValue(/^35/);
  await page.screenshot({ path: '__screenshots__/b14a-hinge-100.png' });
});
