import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { verifyDownloaded } from './nc-verify';
import { expectNoA11yViolations, snap } from './visual/helpers';
import {
  openNewProject,
  paste,
  projectId,
  saved,
  watchConsole,
  wizardReady,
} from './wizard-helpers';

/**
 * T325 (D-112, usta raporu 2 "Elif"): a rectangular blind pocket from the drawing board. A
 * rectangle drawn inside a part becomes its inner contour, its operation is set to "Cep" with a
 * depth, the part is nested and simulated, and the downloaded NC passes the independent checks
 * (pocket depth and boundary included).
 */

const op = tr.editor.inspector.operation;
const trNum = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

async function position(page: Page) {
  const text = (await page.getByTestId('editor-position').textContent()) ?? '';
  const m = /X\s*(-?[\d.,]+)\s*·\s*Y\s*(-?[\d.,]+)/.exec(text);
  return { x: trNum(m?.[1] ?? 'NaN'), y: trNum(m?.[2] ?? 'NaN') };
}

async function screen(canvas: Locator, p: { x: number; y: number }) {
  const [scale = 0, x = 0, y = 0] = ((await canvas.getAttribute('data-view')) ?? '')
    .split(',')
    .map(Number);
  const b = await canvas.boundingBox();
  if (!b) throw new Error('no canvas');
  return { x: b.x + p.x * scale + x, y: b.y + y - p.y * scale };
}

/** One 600 × 400 part with a 300 × 200 rectangle drawn inside it as an inner contour. */
async function partWithRectangle(page: Page): Promise<Locator> {
  await openNewProject(page, 'parcalar');
  await paste(
    page,
    ['Parça adı\tEn\tBoy\tAdet\tDamar', 'Tabela\t600\t400\t1\thayır'].join('\n'),
    1,
  );
  await page.getByTestId('parts-view-drawing').click();
  const canvas = page.getByTestId('editor-canvas');
  await expect(canvas).toHaveAttribute('data-view', /\d/);
  await page.getByTestId('editor-part-list').getByRole('button').first().click();
  const p0 = await position(page);
  await page.keyboard.press('r');
  const a = await screen(canvas, { x: p0.x + 150, y: p0.y + 100 });
  const b = await screen(canvas, { x: p0.x + 450, y: p0.y + 300 });
  await page.mouse.click(a.x, a.y);
  await page.mouse.click(b.x, b.y);
  await page.getByTestId('inner-prompt-inner').click();
  await page.keyboard.press('v');
  await expect(page.getByTestId('prop-inner')).toHaveCount(1);
  return canvas;
}

test('T325: draw a rectangle → Cep → depth → simulate → the NC passes every check', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const problems = watchConsole(page);
  await partWithRectangle(page);

  // "Cep" is offered for the inner contour; picking it brings the depth field and the corner note.
  const picker = page.getByTestId('prop-op-inner-0');
  await picker.click();
  await expect(page.getByRole('option')).toHaveText([
    op.kinds.inside,
    op.kinds.online,
    op.kinds.pocket,
    op.kinds.none,
  ]);
  await page.getByRole('option', { name: op.kinds.pocket }).click();
  await expect(picker).toHaveAttribute('data-value', 'pocket');
  const depth = page.getByTestId('prop-op-inner-0-depth');
  await expect(depth).toHaveValue('5');
  await expect(page.getByTestId('prop-op-inner-0-corners')).toContainText('R');

  // As deep as the stock: refused with the pocket message; the value stays.
  await depth.click();
  await depth.fill('40');
  await depth.press('Enter');
  await expect(page.getByTestId('prop-op-inner-0-depth-error')).toHaveText(op.pocketDepthError);
  await depth.press('Escape');
  await depth.fill('6');
  await depth.press('Enter');
  await expect(depth).toHaveValue('6');
  await snap(page, 't325-pocket-inspector-1440', { baseline: false });
  await expectNoA11yViolations(page, { exclude: ['[data-sonner-toaster]'] });
  await saved(page);
  const id = await projectId(page);

  // Nest, simulate (checks green), export and download.
  await page.getByTestId('wizard-next').click();
  await wizardReady(page, 'dizilim');
  await page.getByRole('button', { name: tr.cutList.nesting.run, exact: true }).click();
  await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
  await saved(page);
  await page.getByTestId('wizard-next').click();
  await wizardReady(page, 'simulasyon');
  await expect(page.getByTestId('sim-check-status')).toHaveAttribute('data-ok', 'true', {
    timeout: 30_000,
  });
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
  const verdict = await verifyDownloaded(page.request, id, [
    { name: d.suggestedFilename(), content, sheet: 0 },
  ]);
  expect(verdict.violations).toEqual([]);
  expect(verdict.ok).toBe(true);
  // The part is cut out; the pocket is not a through loop.
  expect(verdict.partsExpected).toBe(1);
  expect(verdict.partsCut).toBe(1);
  expect(problems).toEqual([]);
});

test('T325: the pocket inspector at 390 px has no horizontal scroll and no axe violations', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await partWithRectangle(page);
  await page.getByTestId('prop-op-inner-0').click();
  await page.getByRole('option', { name: op.kinds.pocket }).click();
  await expect(page.getByTestId('prop-op-inner-0-depth')).toHaveValue('5');
  await page.setViewportSize({ width: 390, height: 844 });
  const scroll = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(scroll).toBeLessThanOrEqual(0);
  await snap(page, 't325-pocket-390', { baseline: false });
  await expectNoA11yViolations(page, { exclude: ['[data-sonner-toaster]'] });
});
