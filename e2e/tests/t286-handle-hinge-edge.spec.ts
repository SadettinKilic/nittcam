import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  openNewProject,
  paste,
  pickOption,
  saved,
  watchConsole,
  wizardReady,
} from './wizard-helpers';

/**
 * T286 (CTO review #9 A): a ready handle placed from the panel (no ghost) goes to the edge
 * opposite the door's hinges; moved onto the hinge edge by hand it warns at the instance and on the
 * Dışa aktar checklist, without blocking.
 */

const tpl = tr.editor.inspector.template;
const DOOR = ['Parça adı\tEn\tBoy\tAdet\tDamar', 'Kapak\t396\t716\t1\thayır'].join('\n');
const trNum = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

async function holeX(page: Page, i: number) {
  return trNum((await page.getByTestId(`prop-hole-${i}-cx`).inputValue()) || 'NaN');
}

async function placeReady(page: Page, door: ReturnType<Page['getByTestId']>, name: string) {
  await page.getByTestId('template-add').click();
  await page.getByTestId('template-menu-item').filter({ hasText: name }).click();
  await page.getByTestId('template-place').click();
  await expect(page.getByTestId('template-pending')).toBeHidden();
  await door.click();
}

test('handle goes opposite the hinges; on the hinge edge it warns, never blocks', async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const problems = watchConsole(page);

  await openNewProject(page, 'parcalar');
  await paste(page, DOOR, 1);
  await page.getByTestId('parts-view-drawing').click();
  await expect(page.getByTestId('editor-canvas')).toHaveAttribute('data-view', /\d/);
  const door = page.getByTestId('editor-part-list').getByRole('button').first();
  await door.click();

  await placeReady(page, door, 'Menteşe çukuru Ø35 (2 menteşe)');
  await placeReady(page, door, 'Kulp deliği 128 mm');
  // hinge cups on the left edge, handle holes 30 mm from the right edge (396 - 30)
  expect(await holeX(page, 0)).toBe(22.5);
  expect(await holeX(page, 2)).toBe(366);
  expect(await holeX(page, 3)).toBe(366);
  await expect(page.getByTestId('template-instance-1-edge')).toHaveAttribute('data-value', 'right');
  await expect(page.getByTestId('template-instance-1-hinge-edge')).toHaveCount(0);

  // moved onto the hinge edge by hand: a warning at the instance
  await pickOption(page.getByTestId('template-instance-1-edge'), tpl.edges.left);
  await expect(page.getByTestId('template-instance-1-hinge-edge')).toHaveText(tpl.hingeEdge);
  expect(await holeX(page, 2)).toBe(30);
  await saved(page);

  await page.getByTestId('wizard-next').click();
  await wizardReady(page, 'dizilim');
  await page
    .locator(
      'button[data-testid^="layout-mode-"][aria-pressed="true"]:visible, [data-testid="layout-nest-compact"]:visible',
    )
    .click();
  await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
  await saved(page);
  await page.getByTestId('wizard-next').click();
  await wizardReady(page, 'simulasyon');
  await page.getByTestId('wizard-next').click();
  await wizardReady(page, 'export');
  await expect(page.getByTestId('export-status')).toHaveAttribute('data-ok', 'true', {
    timeout: 30_000,
  });
  // the checklist line is there and the download is not blocked by it
  await expect(page.getByTestId('export-hinge-handle')).toHaveText(
    tr.wizard.export.hingeHandle.replace('{names}', 'Kapak'),
  );
  for (const c of ['origin', 'tool', 'aircut', 'templates']) {
    await page.getByTestId(`export-check-${c}`).check();
  }
  const toolChange = page.getByTestId('export-check-toolchange');
  if (await toolChange.count()) await toolChange.check();
  await page.getByTestId('export-accept').check();
  await expect(page.getByTestId('export-download')).toBeEnabled();
  expect(problems).toEqual([]);
});
