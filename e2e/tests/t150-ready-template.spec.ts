import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { verifyDownloaded } from './nc-verify';
import {
  openNewProject,
  paste,
  projectId,
  saved,
  watchConsole,
  wizardReady,
} from './wizard-helpers';

/**
 * T150 (other half of the M5 exit): a door gets the ready "Menteşe çukuru Ø35 (2 menteşe)"
 * template from the ready library, is nested, simulated and exported; the downloaded NC is judged
 * on its own by the G-code reader and every automatic check (cups 5 mm from the door edge).
 */

const tpl = tr.editor.inspector.template;
const DOOR = ['Parça adı\tEn\tBoy\tAdet\tDamar', 'Kapak\t396\t716\t1\thayır'].join('\n');
const trNum = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

async function holeX(page: Page, i: number) {
  return trNum((await page.getByTestId(`prop-hole-${i}-cx`).inputValue()) || 'NaN');
}

test('hinge door with the ready hinge template → nest → NC passes every check', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const problems = watchConsole(page);

  await openNewProject(page, 'parcalar');
  await paste(page, DOOR, 1);
  await page.getByTestId('parts-view-drawing').click();
  await expect(page.getByTestId('editor-canvas')).toHaveAttribute('data-view', /\d/);
  const door = page.getByTestId('editor-part-list').getByRole('button').first();
  await door.click();

  // The ready library is in the menu, marked as not yet verified against manufacturer data.
  await page.getByTestId('template-add').click();
  const item = page
    .getByTestId('template-menu-item')
    .filter({ hasText: 'Menteşe çukuru Ø35 (2 menteşe)' });
  await expect(item).toContainText(tpl.readyUnverified);
  await item.click();
  await page.getByTestId('template-place').click();
  await expect(page.getByTestId('template-pending')).toBeHidden();
  await door.click();
  await expect(page.getByTestId('template-instance-0')).toContainText('Menteşe çukuru Ø35');
  expect(await holeX(page, 0)).toBe(22.5);
  expect(await holeX(page, 1)).toBe(22.5);
  await saved(page);
  const id = await projectId(page);

  await page.getByTestId('wizard-next').click();
  await wizardReady(page, 'dizilim');
  await page.getByRole('button', { name: tr.cutList.nesting.run, exact: true }).click();
  await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('nesting-sheets')).toHaveText('1');
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
  // the cups and the outline may use different tools
  const toolChange = page.getByTestId('export-check-toolchange');
  if (await toolChange.count()) await toolChange.check();
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
  expect(verdict.partsExpected).toBe(1);
  expect(verdict.partsCut).toBe(1);
  expect(problems).toEqual([]);
});
