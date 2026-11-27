import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { goStep, KITCHEN, openNewProject, paste } from './wizard-helpers';

// B65 tester: axe + overflow + screenshots on the screens the batch touches (T378-T381).
for (const [width, height] of [
  [1440, 900],
  [1024, 768],
  [390, 844],
] as const) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`B65 ${width} ${scheme}: Dizilim has no serious axe issue and no page scroll`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.setViewportSize({ width, height });
      await openNewProject(page, 'parcalar');
      await paste(page, KITCHEN, 5);
      await goStep(page, 'dizilim');
      await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `e2e/__screenshots__/b65-dizilim-${width}-${scheme}.png` });
      const res = await new AxeBuilder({ page }).analyze();
      const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(bad.map((v) => `${v.id}: ${v.nodes[0]?.html.slice(0, 100)}`)).toEqual([]);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
    });
  }
}
