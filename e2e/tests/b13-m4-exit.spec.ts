import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { verifyDownloaded } from './nc-verify';
import {
  fill,
  openNewProject,
  pickOption,
  projectId,
  saved,
  watchConsole,
  wizardReady,
} from './wizard-helpers';

/**
 * T137: the M4 exit criterion (spec §11). A freeform part is drawn on the board with lines, an
 * arc and a fillet, nested, simulated and exported; the downloaded NC is then judged on its own
 * by the project's G-code reader and automatic checks in node (as T024 does for the cut list).
 */

const ins = tr.editor.inspector;
const partRows = (page: Page) => page.getByTestId('editor-part-list').getByRole('button');

/** Types one segment of the active line/arc tool: length (chord), Tab, angle, Enter. */
async function segment(page: Page, length: number, angle: number) {
  await page.keyboard.type(String(length));
  await page.keyboard.press('Tab');
  await page.keyboard.type(String(angle));
  await page.keyboard.press('Enter');
}

test.describe('T137 editor end-to-end: draw → nest → simulate → NC (M4 exit)', () => {
  test('L-shape with an arc and a fillet gives an NC file that passes every check', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const problems = watchConsole(page);

    // --- Draw: an L of 600 × 600 with a 300 mm leg; the top edge is an arc (R 200) ------------
    await openNewProject(page, 'parcalar');
    await page.getByTestId('parts-view-drawing').click();
    const canvas = page.getByTestId('editor-canvas');
    await expect(canvas).toHaveAttribute('data-view', /\d/);
    const b = await canvas.boundingBox();
    if (!b) throw new Error('no canvas');
    await canvas.focus();
    await page.keyboard.press('l');
    await page.mouse.click(b.x + b.width * 0.4, b.y + b.height * 0.75);
    await segment(page, 600, 0);
    await segment(page, 300, 90);
    await segment(page, 300, 180);
    await segment(page, 300, 90);
    // The arc tool continues the same outline: chord 300 mm to the left, bent to R 200.
    await page.keyboard.press('a');
    await segment(page, 300, 180);
    await expect(page.getByTestId('editor-hint')).toHaveText(tr.editor.draw.hints.arcBend);
    await page.keyboard.type('200');
    await page.keyboard.press('Enter');
    // Back to lines: closing edge down to the start.
    await page.keyboard.press('l');
    await segment(page, 600, 270);
    await expect(partRows(page)).toHaveCount(1);
    await page.keyboard.press('v');
    await partRows(page).first().click();
    await expect(page.getByTestId('editor-inspector')).toContainText(ins.kind.freeform);
    await expect(page.getByTestId('editor-size')).toHaveText(/600\s*×\s*6\d\d/);

    // --- Fillet: round the first (convex) corner with R 25 -----------------------------------
    await pickOption(page.getByTestId('prop-vertex-pick'), fill(ins.vertexN, { n: 2 }));
    const r = page.getByTestId('prop-fillet-r');
    await r.fill('25');
    await r.press('Enter');
    await expect(page.getByTestId('prop-fillet')).toBeDisabled();
    await saved(page);
    const id = await projectId(page);

    // The saved part really has an arc edge and the fillet (bulges ≠ 0 on two edges at least).
    const detail = (await (await page.request.get(`/api/projects/${id}`)).json()) as {
      project: { parts: { kind: string; outline?: { bulge: number }[] }[] };
    };
    const part = detail.project.parts[0];
    expect(part?.kind).toBe('freeform');
    const bulges = (part?.outline ?? []).filter((v) => Math.abs(v.bulge) > 1e-9);
    expect(bulges.length).toBeGreaterThanOrEqual(2);

    // --- Nest ----------------------------------------------------------------------------------
    await page.getByTestId('wizard-next').click();
    await wizardReady(page, 'dizilim');
    await page.getByRole('button', { name: tr.cutList.nesting.run, exact: true }).click();
    await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('nesting-sheets')).toHaveText('1');
    await saved(page);

    // --- Simulate: every check green ------------------------------------------------------------
    await page.getByTestId('wizard-next').click();
    await wizardReady(page, 'simulasyon');
    await expect(page.getByTestId('sim-canvas').locator('canvas').first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('sim-check-status')).toHaveAttribute('data-ok', 'true', {
      timeout: 30_000,
    });

    // --- Export and download ----------------------------------------------------------------
    await page.getByTestId('wizard-next').click();
    await wizardReady(page, 'export');
    await expect(page.getByTestId('export-status')).toHaveAttribute('data-ok', 'true', {
      timeout: 30_000,
    });
    await page.getByTestId('export-check-origin').check();
    await page.getByTestId('export-check-tool').check();
    await page.getByTestId('export-check-aircut').check();
    await page.getByTestId('export-accept').check();
    const download = page.getByTestId('export-download');
    await expect(download).toBeEnabled();
    const [d] = await Promise.all([page.waitForEvent('download'), download.click()]);
    const content = (await readFile(await d.path())).toString('utf8');

    // Arcs leave the post as G2/G3, not as a chain of short lines.
    expect(content).toMatch(/^N?\d*\s*G0?[23]\b/m);
    const verdict = await verifyDownloaded(page.request, id, [
      { name: d.suggestedFilename(), content, sheet: 0 },
    ]);
    expect(verdict.violations).toEqual([]);
    expect(verdict.ok).toBe(true);
    expect(verdict.partsExpected).toBe(1);
    expect(verdict.partsCut).toBe(1);
    expect(problems).toEqual([]);
  });
});
