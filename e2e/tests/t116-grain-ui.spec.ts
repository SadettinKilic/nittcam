import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { fill, openNewProject, paste } from './wizard-helpers';

// T116: grain in the UI. Sheet dial with live preview (one undo step per drag), cut-list grain
// cell with popover dial, fixed/free switch and "apply to all" (one undo step).
const PARTS = ['Parça adı\tEn\tBoy\tAdet', 'Kapak\t400\t700\t1', 'Raf\t500\t300\t2'].join('\n');

test('sheet dial: live preview while dragging, one undo step per drag', async ({ page }) => {
  await openNewProject(page, 'makine');
  const dial = page.getByTestId('sheet-grain-dial');
  const preview = page.getByTestId('sheet-preview-grain');
  await expect(dial).toHaveAttribute('aria-valuenow', '0');
  await dial.scrollIntoViewIfNeeded();
  const box = await dial.boundingBox();
  if (!box) throw new Error('dial not visible');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const at = (deg: number) => {
    const t = (deg * Math.PI) / 180;
    return [cx + 40 * Math.cos(t), cy - 40 * Math.sin(t)] as const;
  };
  await page.mouse.move(...at(10));
  await page.mouse.down();
  await page.mouse.move(...at(20), { steps: 3 });
  await page.mouse.move(...at(30), { steps: 3 });
  await expect(preview).toHaveAttribute('data-angle', '30');
  await page.mouse.up();
  await expect(dial).toHaveAttribute('aria-valuenow', '30');
  await page.getByTestId('wizard-undo').click();
  await expect(dial).toHaveAttribute('aria-valuenow', '0');
  await expect(preview).toHaveAttribute('data-angle', '0');
});

test('cut list: grain popover sets a fixed angle; apply to all is one undo step', async ({
  page,
}) => {
  await openNewProject(page, 'parcalar');
  await paste(page, PARTS, 2);
  const cell1 = page.getByTestId('grain-cell-1');
  const cell2 = page.getByTestId('grain-cell-2');
  await expect(cell1).toHaveAttribute('data-mode', 'free');
  await expect(cell1).toHaveText(tr.cutList.grainCell.free);

  await cell1.click();
  const dial = page.getByTestId('grain-dial-1');
  await expect(dial).toBeVisible();
  await page.getByTestId('grain-dial-1-input').fill('30');
  await page.getByTestId('grain-dial-1-input').press('Enter');
  await expect(cell1).toHaveAttribute('data-mode', 'fixed');
  await expect(cell1).toHaveAttribute('data-angle', '30');
  await expect(
    page.getByLabel(fill(tr.cutList.cellLabel, { n: 1, column: tr.cutList.columns.grain }), {
      exact: true,
    }),
  ).toBeChecked();

  await page.getByTestId('grain-apply-all-1').click();
  await page.keyboard.press('Escape');
  await expect(cell2).toHaveAttribute('data-angle', '30');
  await expect(cell2).toHaveAttribute('data-mode', 'fixed');
  await expect(cell2).toContainText('30°');

  await page.getByTestId('wizard-undo').click();
  await expect(cell2).toHaveAttribute('data-mode', 'free');
  await expect(cell1).toHaveAttribute('data-angle', '30');

  // The free/fixed switch keeps the angle.
  await cell1.click();
  await page.getByTestId('grain-fixed-1').click();
  await expect(cell1).toHaveAttribute('data-mode', 'free');
  await expect(cell1).toHaveAttribute('data-angle', '30');
});
