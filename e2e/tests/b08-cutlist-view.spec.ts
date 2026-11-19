import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { expectNoA11yViolations } from './visual/helpers';
import { fill, openNewProject, paste, projectId, saved, watchConsole } from './wizard-helpers';

/** B8: cut list organisation (T123) and quiet, stable grid (T253). */

const t = tr.cutList;
const v = t.view;

const cell = (page: Page, n: number, column: string) =>
  page.getByLabel(fill(t.cellLabel, { n, column }), { exact: true });

const LIST = [
  'Ad\tEn\tBoy\tAdet',
  'Yan dikme\t560\t720\t2',
  'Şapka\t600\t100\t1',
  'Raf\t528\t540\t3',
  'Kapak\t396\t716\t1',
].join('\n');

async function storedNames(page: Page): Promise<string[]> {
  await saved(page);
  const id = await projectId(page);
  const res = await page.request.get(`/api/projects/${id}`);
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { project: { parts: { name: string }[] } };
  return body.project.parts.map((p) => p.name);
}

/** Names of the visible rows, top to bottom. */
async function shownNames(page: Page): Promise<string[]> {
  return page
    .getByTestId('cut-list-row')
    .evaluateAll((rows) =>
      rows.map(
        (r) => (r.querySelector('input[id$="-name"]') as HTMLInputElement | null)?.value ?? '',
      ),
    );
}

test.describe('T123 cut list organisation', () => {
  test('search (Turkish folding), sort, issue filter; the project order never changes', async ({
    page,
  }) => {
    const problems = watchConsole(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'parcalar');
    await paste(page, LIST, 4);
    const original = ['Yan dikme', 'Şapka', 'Raf', 'Kapak'];
    await expect.poll(() => shownNames(page)).toEqual(original);

    // Search folds Turkish letters and case.
    const search = page.getByTestId('cut-list-search');
    await search.fill('SAPKA');
    await expect.poll(() => shownNames(page)).toEqual(['Şapka']);
    await expect(page.getByTestId('cut-list-shown')).toHaveText(
      fill(v.shown, { shown: 1, total: 4 }),
    );
    await search.press('Escape');
    await expect(search).toHaveValue('');

    // Sort by En: ascending, descending, off.
    const wHeader = page.getByRole('columnheader', { name: t.columns.w });
    await page.getByTestId('sort-w').click();
    await expect(wHeader).toHaveAttribute('aria-sort', 'ascending');
    await expect.poll(() => shownNames(page)).toEqual(['Kapak', 'Raf', 'Yan dikme', 'Şapka']);
    await page.getByTestId('sort-w').click();
    await expect(wHeader).toHaveAttribute('aria-sort', 'descending');
    await expect.poll(() => shownNames(page)).toEqual(['Şapka', 'Yan dikme', 'Raf', 'Kapak']);
    // Keyboard follows the view: ArrowDown from the first shown row lands on the second.
    await cell(page, 2, t.columns.name).focus();
    await page.keyboard.press('ArrowDown');
    await expect(cell(page, 1, t.columns.name)).toBeFocused();
    // Sorting is view only: the stored project keeps its order.
    expect(await storedNames(page)).toEqual(original);
    await page.getByTestId('sort-w').click();
    await expect(wHeader).not.toHaveAttribute('aria-sort');
    await expect.poll(() => shownNames(page)).toEqual(original);

    // "Hatalı satırlar": only the part larger than the sheet.
    await cell(page, 3, t.columns.w).fill('9000');
    await cell(page, 3, t.columns.w).press('Tab');
    await page.getByTestId('cut-list-issues-only').click();
    await expect(page.getByTestId('cut-list-issues-only')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => shownNames(page)).toEqual(['Raf']);
    await page.getByTestId('cut-list-reset').click();
    await expect.poll(() => shownNames(page)).toEqual(original);
    expect(await storedNames(page)).toEqual(original);
    expect(problems).toEqual([]);
  });

  test('groups: editable label, collapse, ungrouped last', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'parcalar');
    await paste(page, LIST, 4);
    // The group label is a grid cell.
    await cell(page, 1, t.columns.group).fill('Dolap 1');
    await cell(page, 1, t.columns.group).press('Enter');
    await cell(page, 4, t.columns.group).fill('Dolap 1');
    await cell(page, 4, t.columns.group).press('Tab');
    await page.getByTestId('cut-list-group-by').click();
    const groups = page.getByTestId('cut-list-group');
    await expect(groups).toHaveCount(2);
    await expect(groups.nth(0)).toHaveAttribute('data-group', 'Dolap 1');
    await expect(groups.nth(1)).toHaveAttribute('data-group', '');
    await expect(groups.nth(1)).toContainText(v.ungrouped);
    await expect.poll(() => shownNames(page)).toEqual(['Yan dikme', 'Kapak', 'Şapka', 'Raf']);
    // Collapse hides the rows in the view only.
    const toggle = groups.nth(0).getByTestId('cut-list-group-toggle');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(() => shownNames(page)).toEqual(['Şapka', 'Raf']);
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(t.count, { rows: 4, pieces: 7 }),
    );
    await expectNoA11yViolations(page, { exclude: ['[data-sonner-toaster]'] });
    await toggle.click();
    await expect.poll(() => shownNames(page)).toEqual(['Yan dikme', 'Kapak', 'Şapka', 'Raf']);
    expect(await storedNames(page)).toEqual(['Yan dikme', 'Şapka', 'Raf', 'Kapak']);
  });
});

test.describe('T253 quiet zeros and a grid that stays put', () => {
  for (const width of [1440, 1280]) {
    test(`${width}: the first issue moves no cell; zero bands are a dimmed dash`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openNewProject(page, 'parcalar');
      await paste(page, LIST, 4);
      // Zero bands: a dash until focused, the number while focused (wide layout only).
      const quiet = page.locator('[data-quiet-zero]');
      if (width === 1440) {
        await expect(quiet.first()).toBeVisible();
        const top = page.getByLabel(fill(t.edgeLabel, { n: 1, edge: t.edge.top }), {
          exact: true,
        });
        await expect(top).toHaveValue('0');
        await top.focus();
        await expect(quiet).toHaveCount(16);
        await expect(quiet.first()).toBeHidden();
      }
      const boxes = async () =>
        page
          .getByTestId('cut-list-row')
          .first()
          .locator('td')
          .evaluateAll((tds) => tds.map((td) => Math.round(td.getBoundingClientRect().x)));
      const before = await boxes();
      await cell(page, 1, t.columns.w).fill('9000');
      await cell(page, 1, t.columns.w).press('Tab');
      await expect(page.getByTestId('cut-list-issue-chip')).toHaveAttribute('data-count', '1');
      // The Uyarılar panel floats over the page; the grid keeps every cell in place.
      await expect(page.getByTestId('validation-panel')).toBeVisible();
      expect(await boxes()).toEqual(before);
      // The chip closes and reopens it.
      const chip = page.getByTestId('cut-list-issue-chip');
      await chip.click();
      await expect(page.getByTestId('validation-panel')).toHaveCount(0);
      await chip.click();
      await expect(page.getByTestId('validation-panel')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('validation-panel')).toHaveCount(0);
      await expect(chip).toHaveAttribute('aria-expanded', 'false');
    });
  }
});
