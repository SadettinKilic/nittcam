import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { expectNoA11yViolations } from './visual/helpers';
import { fill, openNewProject, watchConsole } from './wizard-helpers';

/** B8: parametric cabinet box generator (T122, D-041). */

const c = tr.cutList.cabinet;
const t = tr.cutList;

const cell = (page: Page, n: number, column: string) =>
  page.getByLabel(fill(t.cellLabel, { n, column }), { exact: true });

async function setNumber(page: Page, testId: string, value: string) {
  const input = page.getByTestId(testId);
  await input.fill(value);
}

test.describe('T122 cabinet generator', () => {
  test('defaults, live preview, keyboard flow; one undo removes the whole cabinet', async ({
    page,
  }) => {
    const problems = watchConsole(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'parcalar');
    await page.getByTestId('cabinet-open').click();
    const dialog = page.getByTestId('cabinet-dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('cabinet-group')).toHaveValue(fill(c.defaultGroup, { n: 1 }));
    // Default base unit: 2 sides, top, bottom, 1 shelf, 1 door = 6 pieces in 5 rows; the 8 mm
    // back is not in the 18 mm list unless ticked (T260, D-045).
    await expect(page.getByTestId('cabinet-add')).toHaveText(fill(c.add, { count: 6 }));
    await expect(dialog.locator('[data-part=back][data-other]')).toContainText(
      fill(c.otherBoard, { t: '8' }),
    );
    await page.getByTestId('cabinet-include-other').click();
    await expect(page.getByTestId('cabinet-add')).toHaveText(fill(c.add, { count: 7 }));
    await page.getByTestId('cabinet-include-other').click();
    await expect(page.getByTestId('cabinet-add')).toHaveText(fill(c.add, { count: 6 }));
    await expect(dialog.locator('[data-role=door]')).toHaveCount(1);
    await expectNoA11yViolations(page);
    // Live preview: two doors and three shelves show at once.
    await dialog.getByRole('radio', { name: c.doorCount[2] }).click();
    await setNumber(page, 'cabinet-shelves', '3');
    await expect(dialog.locator('[data-role=door]')).toHaveCount(2);
    await expect(dialog.locator('[data-role=shelf]')).toHaveCount(3);
    // An impossible box disables the button and says why.
    await setNumber(page, 'cabinet-width', '20');
    await expect(page.getByTestId('cabinet-error')).toHaveText(c.errors.tooNarrow);
    await expect(page.getByTestId('cabinet-add')).toBeDisabled();
    await setNumber(page, 'cabinet-width', '800');
    // Keyboard: Enter in a field adds the parts.
    await page.getByTestId('cabinet-depth').press('Enter');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(t.count, { rows: 5, pieces: 9 }),
    );
    await expect(cell(page, 1, t.columns.name)).toHaveValue(c.roles.side);
    await expect(cell(page, 1, t.columns.w)).toHaveValue('560');
    await expect(cell(page, 2, t.columns.w)).toHaveValue('764');
    // One undo removes every generated row.
    await page.getByTestId('wizard-undo').click();
    await expect(page.getByText(t.empty)).toBeVisible();
    // Esc closes without adding.
    await page.getByTestId('cabinet-open').click();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(t.empty)).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('generated rows are plain rows: delete, copy and edit one leaves the rest', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'parcalar');
    await page.getByTestId('cabinet-open').click();
    // Added on purpose: the 8 mm back joins the list with its thickness as a note (T260).
    await page.getByTestId('cabinet-include-other').click();
    await page.getByTestId('cabinet-add').click();
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(t.count, { rows: 6, pieces: 7 }),
    );
    // Edit the top (row 2) width: the bottom (row 3) keeps its size.
    const w2 = cell(page, 2, t.columns.w);
    await w2.fill('500');
    await w2.press('Enter');
    await expect(cell(page, 2, t.columns.w)).toHaveValue('500');
    await expect(cell(page, 3, t.columns.w)).toHaveValue('564');
    // Delete the shelf (row 4): 5 rows, the back moves up unchanged.
    await page.getByRole('button', { name: fill(t.rowMenu.label, { n: 4 }) }).click();
    await page.getByRole('menuitem', { name: t.rowMenu.remove }).click();
    await expect(page.getByTestId('cut-list-count')).toHaveText(
      fill(t.count, { rows: 5, pieces: 6 }),
    );
    await expect(cell(page, 4, t.columns.name)).toHaveValue(c.roles.back);
    await expect(cell(page, 4, t.columns.w)).toHaveValue('564');
  });
});
