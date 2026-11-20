import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openNewProject } from './wizard-helpers';

/** B21 tester: axe on the new 3D controls (1440) and a 390 px smoke. */
test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] } });

for (const [w, h] of [
  [1440, 900],
  [390, 844],
] as const) {
  test(`sheet 3D controls: axe clean, no horizontal scroll @${w}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await openNewProject(page, 'makine');
    const panel = page.getByTestId('sheet-preview');
    await panel.getByTestId('view-3d').click();
    await expect(panel.getByTestId('preview3d')).toHaveAttribute('data-ready', 'true', {
      timeout: 20_000,
    });
    const res = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
    expect(bad.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(over).toBeLessThanOrEqual(1);
  });
}
