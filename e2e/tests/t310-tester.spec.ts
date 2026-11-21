import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { goStep, nest, openNewProject, projectId, saved, wizardReady } from './wizard-helpers';

/**
 * T310 tester: the assembly view of two doors with handle holes and hinge cups, at 1440 and 390,
 * light and dark: renders, no page-level horizontal scroll, axe clean. Screenshots for review.
 */
const c = tr.cutList.cabinet;

async function doorHoles(request: APIRequestContext, id: string) {
  const cur = (await (await request.get(`/api/projects/${id}`)).json()) as {
    revision: number;
    project: { parts: { name: string; params: { w: number; h: number }; holes: unknown[] }[] };
  };
  const door = cur.project.parts.find((p) => p.name === c.roles.door);
  if (!door) throw new Error('no door');
  const { w, h } = door.params;
  door.holes = [
    { id: 'k1', type: 'through', tool: 2, d: 10, cx: w - 40, cy: h - 60 },
    { id: 'k2', type: 'through', tool: 2, d: 10, cx: w - 40, cy: h - 160 },
    { id: 'm1', type: 'pocket', tool: 2, d: 35, cx: 22.5, cy: 100, depth: 12 },
  ];
  const res = await request.put(`/api/projects/${id}`, {
    data: { project: cur.project, baseRevision: cur.revision, commands: [] },
  });
  expect(res.status(), await res.text()).toBe(200);
}

for (const width of [1440, 390]) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`T310 tester: two doors with cups, assembly ${width} ${scheme}`, async ({
      page,
      request,
    }) => {
      test.setTimeout(120_000);
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
      await page.setViewportSize({ width: 1440, height: 900 });
      await openNewProject(page, 'parcalar');
      await page.getByTestId('cabinet-open').click();
      await page.getByTestId('cabinet-dialog').getByRole('radio', { name: c.doorCount[2] }).click();
      await page.getByTestId('cabinet-add').click();
      await expect(page.getByTestId('cabinet-dialog')).toHaveCount(0);
      await saved(page);
      const id = await projectId(page);
      await doorHoles(request, id);
      await page.goto(`/projeler/${id}?adim=parcalar`);
      await wizardReady(page, 'parcalar');
      await nest(page);
      await goStep(page, 'dizilim');
      await page.setViewportSize({ width, height: 900 });
      await page.getByTestId('view-3d').click();
      await expect(page.getByTestId('preview3d')).toHaveAttribute('data-ready', 'true', {
        timeout: 30_000,
      });
      const toggle = page.getByTestId('preview3d-assembly');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
      await expect(page.getByTestId('preview3d-assembly-canvas')).toBeVisible();
      await page.waitForTimeout(1500);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
      await page.screenshot({ path: `__screenshots__/t310-tester-${width}-${scheme}.png` });
      const res = await new AxeBuilder({ page }).analyze();
      const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
      expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
    });
  }
}
