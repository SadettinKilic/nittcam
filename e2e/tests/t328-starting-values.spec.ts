import { expect, test, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { pickOption } from './wizard-helpers';

/**
 * T328 (D-120): a new cutting set in the machine form starts from the built-in table for its kind,
 * thickness and tool, says where the numbers come from and stays unverified. Kind / tool changes
 * refresh an untouched row; a manual edit is never overwritten; no table row → empty fields.
 * The new machine form uses the generic profile: tool 1 = Ø6 two-flute, tool 2 = Ø8 two-flute.
 */

const t = tr.machines;

async function addSet(page: Page): Promise<{ row: Locator; detail: Locator }> {
  await page.goto('/makineler');
  await page.getByRole('button', { name: t.add }).click();
  await expect(page.getByTestId('machine-form')).toBeVisible({ timeout: 30_000 });
  const table = page.getByTestId('materials-table');
  await page.locator('#sec-materials').getByRole('button', { name: t.form.add }).click();
  return {
    row: table.locator('tbody tr:not([data-detail])').last(),
    detail: table.locator('tbody tr[data-detail]').last(),
  };
}

async function values(row: Locator): Promise<number[]> {
  const out: number[] = [];
  for (const k of ['feed', 'plungeFeed', 'rpm', 'stepDown']) {
    const raw = await row.locator(`[id$="-${k}"]`).inputValue();
    out.push(raw === '' ? NaN : Number(raw.replace(/\./g, '').replace(',', '.')));
  }
  return out;
}

test.describe('T328 starting values for a new cutting set', () => {
  test('prefilled from the table, refreshed by kind and tool, an edit is kept', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const { row, detail } = await addSet(page);

    // MDF 18 with tool 1 (Ø6 two-flute): research §d.
    expect(await values(row)).toEqual([5400, 1400, 18000, 6]);
    await expect(detail.getByTestId('material-starting-source')).toHaveAttribute(
      'data-kind',
      'table',
    );
    await expect(detail.getByTestId('material-unverified-note')).toContainText(
      'doğrulanmadı, önce deneme kesimi',
    );
    await expect(detail.getByTestId('material-unverified-confirm')).toBeVisible();

    // Tool 2 (Ø8): today's MDF 18 set exactly.
    const tool = row.locator('[id$="-tool"]');
    await tool.fill('2');
    await tool.press('Tab');
    expect(await values(row)).toEqual([6000, 1500, 18000, 6]);

    // Acrylic with a two-flute tool: refreshed, with the material note and a hint (not a block).
    await pickOption(row.locator('[id$="-material"]'), tr.materials.acrylic);
    expect(await values(row)).toEqual([5000, 2500, 18000, 4]);
    await expect(detail.getByTestId('material-starting-note')).toContainText('O-flute');
    await expect(detail.getByTestId('material-tool-hint')).toBeVisible();

    // A manual edit is the user's own: the mark goes and a kind change keeps the numbers.
    const feed = row.locator('[id$="-feed"]');
    await feed.fill('4100');
    await feed.press('Tab');
    await expect(detail.getByTestId('material-unverified-note')).toHaveCount(0);
    await pickOption(row.locator('[id$="-material"]'), tr.materials.mdf);
    expect((await values(row))[0]).toBe(4100);
  });

  test('no table row: empty fields and "Bu malzeme için hazır değer yok"', async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const { row, detail } = await addSet(page);
    // Melamine with the Ø6 two-flute spiral: the research has no such row.
    await pickOption(row.locator('[id$="-material"]'), tr.materials.melamine);
    const v = await values(row);
    expect(v.every((x) => Number.isNaN(x))).toBe(true);
    await expect(detail.getByTestId('material-starting-source')).toHaveAttribute(
      'data-kind',
      'none',
    );
    await expect(detail).toContainText('Bu malzeme için hazır değer yok');
    // Saving asks for the numbers instead of storing a guess.
    await page.getByRole('button', { name: t.form.save, exact: true }).click();
    await expect(row.locator('[id$="-feed"]')).toHaveAttribute('aria-invalid', 'true');
  });
});
