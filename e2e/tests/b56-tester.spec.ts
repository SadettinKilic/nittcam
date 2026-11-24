import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { applyTheme, expectNoA11yViolations, snap } from './visual/helpers';
import {
  openNewProject,
  openThinSkinProject,
  openWorkspacePanel,
  pasteAndNest,
  toastsSettled,
} from './wizard-helpers';

/**
 * B56 tester (PR #172, T313): a new project's Dizilim step shows the clearance on top of the tool
 * ("pay 0,1"), the note spells out tool Ø + pay = clear distance, and the step stays clean (axe,
 * no page scroll sideways) at 1440 light/dark and 390.
 * D-129: a new project cuts with tabs, so the note shows the effective pay (tool Ø + 3,1) and the
 * tab-spacing note says why; the stored field keeps 0,1. The pay mechanics run on thin skin.
 */
const t = tr.wizard.layout;

for (const vp of [
  { name: 'desktop', width: 1440, height: 900, theme: 'light' },
  { name: 'desktop', width: 1440, height: 900, theme: 'dark' },
  { name: 'mobile', width: 390, height: 844, theme: 'light' },
] as const) {
  test(`Dizilim: stored pay 0,1, effective pay with tabs and the notes, axe ${vp.name} ${vp.theme} (T313)`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await applyTheme(page, vp.theme);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await openNewProject(page, 'parcalar');
    await pasteAndNest(page);
    const panel = await openWorkspacePanel(page, 'left');
    const gap = panel.getByLabel(t.gap);
    await expect(gap).toHaveValue(/^0,1/);
    const note = panel.getByTestId('layout-gap-note');
    await expect(note).toBeVisible();
    const text = (await note.textContent()) ?? '';
    const m = /Ø([\d,]+) \+ pay ([\d,]+) = ([\d,]+) mm/.exec(text);
    expect(m, text).not.toBeNull();
    const [, tool = '', pay = '', clear = ''] = m ?? [];
    const num = (s: string) => Number(s.replace(',', '.'));
    expect(num(pay)).toBeCloseTo(num(tool) + 3.1, 6);
    expect(num(clear)).toBeCloseTo(num(tool) + num(pay), 6);
    await expect(panel.getByTestId('layout-tab-spacing-note')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await toastsSettled(page);
    await expectNoA11yViolations(page);
    await snap(page, `b56-dizilim-${vp.name}-${vp.theme}`, { baseline: false, fullPage: false });
  });
}

test('pay 0,15: the note and the Dizilim help show 0,15 and 8,15 (T313, round 2)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openThinSkinProject(page); // D-129: the stored pay counts with thin skin
  await pasteAndNest(page);
  const panel = await openWorkspacePanel(page, 'left');
  const gap = panel.getByLabel(t.gap);
  await gap.fill('0,15');
  await gap.press('Enter');
  const note = panel.getByTestId('layout-gap-note');
  await expect(note).toContainText('pay 0,15 = 8,15 mm');
  await page.getByRole('button', { name: tr.cutList.nesting.about }).click();
  const help = page.getByRole('dialog').filter({ hasText: '8,15' });
  await expect(help).toContainText('8,15 mm');
  await expect(help).toContainText('pay 0,15 mm');
});
