import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };

/** T169: "Bitmiş ölçü" toggle; the Kesim column shows finished − band per edge; one undo step. */

const t = tr.cutList;
const p = t.paste;
const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));

test('finished size toggle shows the cut size and undoes in one step', async ({ page }) => {
  await page.goto('/projeler/yeni/parcalar');
  await page.getByRole('button', { name: t.pasteOpen }).click();
  await page
    .getByLabel(p.textLabel)
    .fill('Ad\tEn\tBoy\tAdet\tÜst\tAlt\tSol\tSağ\nKapak\t600\t400\t1\t1\t1\t2\t2');
  await page.getByRole('button', { name: fill(p.applyCount, { count: 1 }) }).click();
  await expect(page.getByTestId('cell-cut')).toHaveCount(0);

  await page.getByTestId('dimension-mode').click();
  const cut = page.getByTestId('cell-cut');
  await expect(cut).toHaveAttribute('data-w', '596');
  await expect(cut).toHaveAttribute('data-h', '398');

  await page.getByTestId('wizard-undo').click();
  await expect(page.getByTestId('dimension-mode')).not.toBeChecked();
  await expect(page.getByTestId('cell-cut')).toHaveCount(0);
});
