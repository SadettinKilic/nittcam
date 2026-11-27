import { expect, test, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  openNewProject,
  openThinSkinProject,
  openWorkspacePanel,
  goStep,
  paste,
} from './wizard-helpers';

// T380 (owner 2026-11-28): pay and margin sit in one aligned group, each with its own hint.
async function bb(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error('no box');
  return b;
}

async function boxes(page: Page) {
  // T261 nests on entering the step; at 1024 the left panel may start collapsed.
  await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
  const left = page.getByTestId('workspace-left');
  if ((await left.count()) > 0 && (await left.getAttribute('data-state')) === 'closed')
    await page.getByTestId('workspace-left-toggle').click();
  const panel = await openWorkspacePanel(page, 'left');
  const gap = await bb(panel.getByTestId('layout-gap'));
  const margin = await bb(panel.getByTestId('layout-margin'));
  return { panel, gap, margin };
}

for (const width of [1440, 1024]) {
  test(`T380 ${width}: equal inputs on one line, a hint under each, tabs note once`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await openNewProject(page, 'makine');
    await goStep(page, 'parcalar');
    await paste(page, 'Ad\tEn\tBoy\tAdet\nYan\t560\t720\t1', 1);
    await goStep(page, 'dizilim');
    const { panel, gap, margin } = await boxes(page);
    expect(Math.abs(gap.width - margin.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(gap.y - margin.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(gap.height - margin.height)).toBeLessThanOrEqual(1);
    const gapNote = await bb(panel.getByTestId('layout-gap-note'));
    const marginHint = await bb(panel.getByTestId('layout-margin-hint'));
    // Each hint sits under its own field, on the same line.
    expect(gapNote.y).toBeGreaterThanOrEqual(gap.y + gap.height);
    expect(Math.abs(gapNote.y - marginHint.y)).toBeLessThanOrEqual(1);
    expect(gapNote.x).toBeLessThan(margin.x);
    expect(marginHint.x).toBeGreaterThanOrEqual(margin.x - 1);
    await expect(panel.getByTestId('layout-gap-note')).toContainText(/^Boşluk = Ø/);
    // Tabs on (default): the D-129 note once, under the whole group.
    const note = panel.getByTestId('layout-tab-spacing-note');
    await expect(note).toHaveCount(1);
    const group = await bb(panel.getByTestId('layout-spacing'));
    const noteBox = await bb(note);
    expect(noteBox.y).toBeGreaterThanOrEqual(group.y + group.height);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(0);
  });
}

test('T380: tabs off: no tabs note; an invalid value is reported under its own field', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openThinSkinProject(page, 'makine');
  await goStep(page, 'parcalar');
  await paste(page, 'Ad\tEn\tBoy\tAdet\nYan\t560\t720\t1', 1);
  await goStep(page, 'dizilim');
  const { panel, margin } = await boxes(page);
  await expect(panel.getByTestId('layout-tab-spacing-note')).toHaveCount(0);
  const field = panel.getByTestId('layout-margin');
  await field.fill('abc');
  await field.press('Enter');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  const error = panel.getByText(tr.wizard.machine.errors.number);
  await expect(error).toHaveCount(1);
  const e = await bb(error);
  expect(e.x).toBeGreaterThanOrEqual(margin.x - 1);
  expect(e.y).toBeGreaterThanOrEqual(margin.y + margin.height);
  // A margin below the tool minimum turns the hint into the warning under the same field.
  await field.fill('2');
  await field.press('Enter');
  await expect(panel.getByTestId('layout-margin-warning')).toBeVisible();
  await expect(panel.getByTestId('layout-margin-hint')).toHaveCount(0);
});
