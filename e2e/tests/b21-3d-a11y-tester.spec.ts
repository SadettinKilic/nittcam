import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { openNewProject } from './wizard-helpers';

/** B21 tester: axe on the new 3D controls (1440) and a 390 px smoke. */
test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] } });
// T159: the real frame watch never downgrades the view on the CPU-rendered runner (fps.ts); the
// slow chain is driven by the __nittcam3dSlow hook where a test needs it.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __nittcam3dNoAuto: boolean }).__nittcam3dNoAuto = true;
  });
});

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
