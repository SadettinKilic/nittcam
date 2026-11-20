import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  fill,
  goStep,
  openNewProject,
  paste,
  pasteAndNest,
  projectId,
  saved,
  watchConsole,
  wizardReady,
} from './wizard-helpers';

/** T290: "Aç" opens where work stopped; `?adim=` wins; Liste / Çizim view remembered. */
const t = tr.projects;
const ROWS = ['Parça adı\tEn\tBoy\tAdet', 'Raf\t500\t300\t2'].join('\n');

async function openFromList(page: import('@playwright/test').Page, name: string) {
  await page.goto('/projeler');
  await page.getByTestId('projects-search').fill(name);
  await page
    .getByTestId('project-row')
    .filter({ hasText: name })
    .getByRole('link', { name: fill(t.rowAction, { action: t.open, name }) })
    .click();
}

test('Aç opens Parçalar without a layout, Dizilim with one; ?adim= wins', async ({ page }) => {
  const problems = watchConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  const name = `Devam ${Math.random().toString(36).slice(2, 8)}`;
  await openNewProject(page, 'parcalar');
  await paste(page, ROWS, 1);
  const field = page.getByTestId('project-name');
  await field.fill(name);
  await field.press('Enter');
  await saved(page);
  const id = await projectId(page);

  await openFromList(page, name);
  await wizardReady(page, 'parcalar');

  await goStep(page, 'dizilim');
  await page.getByRole('button', { name: tr.cutList.nesting.run, exact: true }).click();
  await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
  await saved(page);
  await openFromList(page, name);
  await wizardReady(page, 'dizilim');

  // The URL's step wins.
  await page.goto(`/projeler/${id}?adim=makine`);
  await wizardReady(page, 'makine');
  expect(problems).toEqual([]);
});

test('the Parçalar view (Liste / Çizim) is remembered per project; ?gorunum= wins', async ({
  page,
}) => {
  const problems = watchConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page, ROWS, 1);
  await saved(page);
  const id = await projectId(page);
  await goStep(page, 'parcalar');
  await page.getByTestId('parts-view-drawing').click();
  await expect(page.getByTestId('parts-view-drawing')).toHaveAttribute('data-state', 'active');

  await page.goto(`/projeler/${id}?adim=parcalar`);
  await wizardReady(page, 'parcalar');
  await expect(page.getByTestId('parts-view-drawing')).toHaveAttribute('data-state', 'active');

  await page.getByTestId('parts-view-list').click();
  await page.goto(`/projeler/${id}?adim=parcalar`);
  await wizardReady(page, 'parcalar');
  await expect(page.getByTestId('parts-view-list')).toHaveAttribute('data-state', 'active');

  await page.goto(`/projeler/${id}?adim=parcalar&gorunum=cizim`);
  await wizardReady(page, 'parcalar');
  await expect(page.getByTestId('parts-view-drawing')).toHaveAttribute('data-state', 'active');
  expect(problems).toEqual([]);
});
