import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { applyTheme, expectNoA11yViolations, snap } from './visual/helpers';
import { openNewProject, openWorkspacePanel, pasteAndNest, toastsSettled } from './wizard-helpers';

/**
 * B56 tester (PR #172, T313): a new project's Dizilim step shows the clearance on top of the tool
 * ("pay 0,1"), the note spells out tool Ø + pay = clear distance, and the step stays clean (axe,
 * no page scroll sideways) at 1440 light/dark and 390.
 */
const t = tr.wizard.layout;

for (const vp of [
  { name: 'desktop', width: 1440, height: 900, theme: 'light' },
  { name: 'desktop', width: 1440, height: 900, theme: 'dark' },
  { name: 'mobile', width: 390, height: 844, theme: 'light' },
] as const) {
  test(`Dizilim: pay 0,1 and the clear-distance note, axe ${vp.name} ${vp.theme} (T313)`, async ({
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
    expect(num(pay)).toBe(0.1);
    expect(num(clear)).toBeCloseTo(num(tool) + 0.1, 6);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await toastsSettled(page);
    await expectNoA11yViolations(page);
    await snap(page, `b56-dizilim-${vp.name}-${vp.theme}`, { baseline: false, fullPage: false });
  });
}
