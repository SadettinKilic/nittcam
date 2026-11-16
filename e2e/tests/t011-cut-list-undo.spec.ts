import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };

/** T011 tester round 2: regression for "one cell edit = exactly one undo step". */

const t = tr.cutList;
const p = t.paste;
const URL = '/projeler/yeni/parcalar';

const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
const w = (page: Page, n: number) =>
  page.getByLabel(fill(t.cellLabel, { n, column: t.columns.w }), { exact: true });
const undo = (page: Page) => page.getByRole('button', { name: t.undo });
const redo = (page: Page) => page.getByRole('button', { name: t.redo });

async function seed(page: Page): Promise<void> {
  await page.goto(URL);
  await page.getByRole('button', { name: t.pasteOpen }).click();
  await page.getByLabel(p.textLabel).fill('A\t500\t700\t1\nB\t600\t800\t1\nC\t650\t900\t1');
  await page.getByRole('button', { name: fill(p.applyCount, { count: 3 }) }).click();
  await expect(w(page, 3)).toHaveValue('650');
}

test.describe('T011 cut list undo (tester round 2)', () => {
  test('Enter / Tab / click-away edits: one undo step each, 3 undos restore, 3 redos re-apply', async ({
    page,
  }) => {
    await seed(page);

    await w(page, 1).fill('410');
    await page.keyboard.press('Enter');
    await expect(w(page, 2)).toBeFocused();

    await w(page, 2).fill('420');
    await page.keyboard.press('Tab');
    await expect(w(page, 1)).toHaveValue('410');

    await w(page, 3).fill('430');
    await page.getByRole('heading', { level: 1 }).click();
    await expect(w(page, 3)).not.toBeFocused();

    await expect(w(page, 1)).toHaveValue('410');
    await expect(w(page, 2)).toHaveValue('420');
    await expect(w(page, 3)).toHaveValue('430');

    // Three undos, each one reverting exactly one edit (newest first).
    await undo(page).click();
    await expect(w(page, 3)).toHaveValue('650');
    await expect(w(page, 2)).toHaveValue('420');
    await undo(page).click();
    await expect(w(page, 2)).toHaveValue('600');
    await expect(w(page, 1)).toHaveValue('410');
    await undo(page).click();
    await expect(w(page, 1)).toHaveValue('500');
    // (the seeding paste is itself undoable, so the button stays enabled; values prove the count)

    // Three redos re-apply in order.
    await redo(page).click();
    await expect(w(page, 1)).toHaveValue('410');
    await expect(w(page, 2)).toHaveValue('600');
    await redo(page).click();
    await expect(w(page, 2)).toHaveValue('420');
    await expect(w(page, 3)).toHaveValue('650');
    await redo(page).click();
    await expect(w(page, 3)).toHaveValue('430');
    await expect(redo(page)).toBeDisabled();
  });

  test('typing the same value and pressing Enter / Tab / blur adds no undo step', async ({
    page,
  }) => {
    await seed(page);
    // Real edit, undone: leaves a pending redo.
    await w(page, 1).fill('410');
    await page.keyboard.press('Enter');
    await undo(page).click();
    await expect(w(page, 1)).toHaveValue('500');
    await expect(redo(page)).toBeEnabled();

    // Same value: no-op must neither add history nor clear the redo stack.
    await w(page, 1).fill('500');
    await page.keyboard.press('Enter');
    await w(page, 2).fill('600');
    await page.keyboard.press('Tab');
    await w(page, 3).fill('650');
    await page.getByRole('heading', { level: 1 }).click();
    await expect(redo(page)).toBeEnabled();
    await redo(page).click();
    await expect(w(page, 1)).toHaveValue('410');

    // After a real edit, same-value no-ops on top still need only ONE undo to revert that edit.
    await w(page, 2).fill('420');
    await page.keyboard.press('Enter');
    await w(page, 3).fill('650');
    await page.keyboard.press('Enter');
    await w(page, 3).fill('650');
    await page.getByRole('heading', { level: 1 }).click();
    await undo(page).click();
    await expect(w(page, 2)).toHaveValue('600');
    await expect(w(page, 1)).toHaveValue('410');
  });
});

test('ambiguous unit: Uygula disabled with visible helper linked by aria-describedby; textarea focused on open', async ({
  page,
}) => {
  await page.goto(URL);
  await page.getByRole('button', { name: t.pasteOpen }).click();
  const area = page.getByLabel(p.textLabel);
  await expect(area).toBeFocused();
  await area.fill('Kapak\t39,6\t71,6\t2\nRaf\t56,4\t30\t1');
  const apply = page.getByRole('button', { name: fill(p.applyCount, { count: 2 }) });
  await expect(apply).toBeDisabled();
  const helper = page.getByText(p.unit.required, { exact: true });
  await expect(helper).toBeVisible();
  const id = await helper.getAttribute('id');
  expect(id).toBeTruthy();
  await expect(apply).toHaveAttribute('aria-describedby', id ?? '');
  await page.getByLabel(p.unit.cm).check();
  await expect(apply).toBeEnabled();
});
