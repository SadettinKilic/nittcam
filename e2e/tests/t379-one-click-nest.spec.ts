import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { goStep, KITCHEN, openNewProject, paste, openWorkspacePanel } from './wizard-helpers';

// T379 (owner 2026-11-28): one click per goal, no separate "Diz"; multi-sheet end to end.
const n = tr.cutList.nesting;
const modeBtn = (page: Page, m: 'minWaste' | 'fastest' | 'minToolChanges') =>
  page.getByTestId(`layout-mode-${m}`);

function manyParts(): string {
  const rows = ['Ad\tEn\tBoy\tAdet'];
  for (let i = 0; i < 300; i++)
    rows.push(`P${i}\t${40 + ((i * 37) % 260)}\t${40 + ((i * 53) % 210)}\t5`);
  return rows.join('\n');
}

test('T379: a mode click nests at once, the pressed mode re-nests, no "Diz" button', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await paste(page, KITCHEN, 5);
  await goStep(page, 'dizilim');
  // T261: entering the step nests with the last used mode (min waste on a new project).
  await expect(page.getByTestId('nesting-sheets')).toBeVisible({ timeout: 20_000 });
  await expect(modeBtn(page, 'minWaste')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: n.run, exact: true })).toHaveCount(0);

  await modeBtn(page, 'fastest').click();
  await expect(page.getByTestId('layout-mode')).toHaveAttribute('data-value', 'fastest');
  await expect(modeBtn(page, 'fastest')).toHaveAttribute('aria-pressed', 'true');
  await expect(modeBtn(page, 'minWaste')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('layout-mode-result-fastest')).toBeVisible({ timeout: 20_000 });

  // The pressed mode again: nests again (the same option set: same result, no error).
  await modeBtn(page, 'fastest').click();
  await expect(page.getByTestId('layout-mode')).toHaveAttribute('data-value', 'fastest');
  await expect(page.getByText(n.failed.split('{')[0] ?? '')).toHaveCount(0);
  await expect(page.getByTestId('nesting-summary')).toBeVisible();

  // Back to the step later: the last used mode stays.
  await goStep(page, 'parcalar');
  await goStep(page, 'dizilim');
  await expect(modeBtn(page, 'fastest')).toHaveAttribute('aria-pressed', 'true');
});

test('T379: during a run the clicked mode shows progress, "İptal" sits apart, another mode restarts', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await paste(page, manyParts(), 300);
  await goStep(page, 'dizilim');
  await expect(page.getByTestId('nesting-sheets')).toBeVisible({ timeout: 90_000 });

  // "En hızlı" measures the travel too: the slowest mode, so the run is long enough.
  await modeBtn(page, 'fastest').click();
  await expect(modeBtn(page, 'fastest')).toHaveAttribute('data-running', '');
  const cancel = page.getByTestId('nesting-cancel');
  await expect(cancel).toBeVisible();
  // "İptal" is never inside the mode buttons' group.
  await expect(page.getByTestId('layout-mode').getByTestId('nesting-cancel')).toHaveCount(0);

  // Another mode during the run restarts with that mode (no silent cancel).
  await modeBtn(page, 'minToolChanges').click();
  await expect(page.getByTestId('layout-mode')).toHaveAttribute('data-value', 'minToolChanges');
  await expect(page.getByText(n.cancelled)).toHaveCount(0);
  await expect(page.getByTestId('layout-mode-result-minToolChanges')).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.getByTestId('layout-mode-result-fastest')).toHaveCount(0);

  // "İptal" stops a run and keeps the layout.
  const sheets = await page.getByTestId('nesting-sheets').textContent();
  await modeBtn(page, 'fastest').click();
  await expect(cancel).toBeVisible();
  await cancel.click();
  await expect(page.getByText(n.cancelled)).toBeVisible();
  await expect(page.getByTestId('nesting-sheets')).toHaveText(sheets ?? '');
});

for (const count of [2, 3]) {
  test(`T379: a part list that needs ${count} sheets nests onto ${count} sheets and the tabs switch them`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'parcalar');
    // One 1500 × 1900 part per sheet: two never fit side by side or stacked on the stock sheet.
    await paste(page, ['Parça adı\tEn\tBoy\tAdet', `Yan\t1500\t1900\t${count}`].join('\n'), 1);
    await goStep(page, 'dizilim');
    await expect(page.getByTestId('nesting-sheets')).toHaveText(String(count), {
      timeout: 20_000,
    });
    await expect(page.getByTestId('layout-mode-result-minWaste')).toContainText(`${count} plaka`);
    const tabs = page.getByRole('tablist', { name: tr.layout.sheetTabs }).getByRole('tab');
    await expect(tabs).toHaveCount(count);
    const canvas = page.getByTestId('layout-canvas');
    await expect(canvas).toHaveAttribute('aria-label', /^Plaka 1 dizilimi: 1 parça/);
    for (let i = 2; i <= count; i++) {
      await tabs.nth(i - 1).click();
      await expect(tabs.nth(i - 1)).toHaveAttribute('data-state', 'active');
      await expect(canvas).toHaveAttribute(
        'aria-label',
        new RegExp(`^Plaka ${i} dizilimi: 1 parça`),
      );
    }
  });
}

test('T379 390: the compact action nests with the selected goal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openNewProject(page, 'parcalar');
  await paste(page, KITCHEN, 5);
  await goStep(page, 'dizilim');
  const compact = page.getByTestId('layout-nest-compact');
  await expect(compact).toHaveText(tr.wizard.layout.modes.minWaste);
  await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
  const panel = await openWorkspacePanel(page, 'left');
  await panel.getByTestId('layout-mode-fastest').click();
  await expect(panel.getByTestId('layout-mode')).toHaveAttribute('data-value', 'fastest');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
});
