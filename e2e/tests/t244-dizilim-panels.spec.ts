import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { fill, openNewProject, pasteAndNest } from './wizard-helpers';

// T244 (D-039): Dizilim panels carry values, not prose; the per-plate summary exists once.
const n = tr.cutList.nesting;
const l = tr.layout;

/** The sheet sits centred in the canvas at fit (equal room above and below). */
async function expectCentred(page: Page) {
  await page.getByRole('button', { name: l.fit }).click();
  const canvas = page.getByTestId('layout-canvas');
  await expect(async () => {
    const box = await canvas.boundingBox();
    const scale = Number(await canvas.getAttribute('data-scale'));
    const y = Number(await canvas.getAttribute('data-y'));
    const sheetH = Number(await canvas.getAttribute('data-sheet-height')) * scale;
    if (!box) throw new Error('canvas not visible');
    expect(Math.abs(y - (box.height - y - sheetH))).toBeLessThan(2);
    expect(y).toBeGreaterThanOrEqual(50);
  }).toPass();
}

test('Dizilim: chips, one summary, tab row, centred sheet (1440 × 900, 1024 × 768)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page);

  const chips = page.getByTestId('nesting-chips').getByRole('listitem');
  await expect(chips).toHaveText([
    fill(n.gapChip, { value: '8' }),
    fill(n.marginChip, { value: '10' }),
    /^Takım Ø\d+(,\d+)?$/,
  ]);
  await expect(page.getByText(n.toolNote)).toBeHidden();
  await page.getByRole('button', { name: n.about }).click();
  await expect(page.getByText(n.toolNote)).toBeVisible();
  await page.keyboard.press('Escape');

  // KPI labels stay on one line.
  const summary = page.getByTestId('nesting-summary');
  for (const label of [n.sheets, n.waste, n.utilisation]) {
    const box = await summary.getByText(label, { exact: true }).boundingBox();
    expect(box?.height ?? 0).toBeLessThan(20);
  }

  // The right inspector: no summary card; nothing selected → a 2-line hint.
  await expect(page.getByTestId('layout-summary')).toHaveCount(0);
  await expect(page.getByTestId('layout-hint')).toHaveText(l.hint1 + l.hint2);

  // T244 r1 (PO): under 768 px of canvas (both panels open at 1440) the tabs keep their own
  // full-width row above the tools (T199b); wider canvases may share one row.
  const tabs = await page.getByTestId('sheet-tabs-scroll').boundingBox();
  const tools = await page.getByRole('button', { name: l.fit }).boundingBox();
  const canvasW = (await page.getByTestId('layout-canvas').boundingBox())?.width ?? 0;
  if (!tabs || !tools) throw new Error('toolbar not visible');
  if (canvasW < 768) expect(tools.y).toBeGreaterThanOrEqual(tabs.y + tabs.height - 1);
  else {
    expect(tools.y).toBeLessThan(tabs.y + tabs.height);
    expect(tools.x).toBeGreaterThan(tabs.x + tabs.width);
  }
  await expectCentred(page);

  await page.setViewportSize({ width: 1024, height: 768 });
  await expectCentred(page);
});
