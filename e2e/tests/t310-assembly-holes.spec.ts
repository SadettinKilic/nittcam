import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { goStep, nest, openNewProject, projectId, saved, wizardReady } from './wizard-helpers';

/**
 * T310 (owner): holes drawn on a cabinet door show in "Montaj görünümü" where the drawing has
 * them. A single door with asymmetric handle holes near the top right: through holes only → the
 * door seen from the front is the drawing; with a hinge cup the drawing's top stays on top. The
 * math is unit-tested (`assembly.test.ts`); this run renders it and keeps screenshots for review.
 */
const SHOTS = '__screenshots__/t310';
const c = tr.cutList.cabinet;

async function doorHoles(request: APIRequestContext, id: string, cups: boolean) {
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
    { id: 'k3', type: 'through', tool: 2, d: 12, cx: w - 90, cy: h - 60 },
    ...(cups ? [{ id: 'm1', type: 'pocket', tool: 2, d: 35, cx: 22.5, cy: 100, depth: 12 }] : []),
  ];
  const res = await request.put(`/api/projects/${id}`, {
    data: { project: cur.project, baseRevision: cur.revision, commands: [] },
  });
  expect(res.status(), await res.text()).toBe(200);
}

async function assembly(page: Page, request: APIRequestContext, cups: boolean, name: string) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await page.getByTestId('cabinet-open').click();
  await page.getByTestId('cabinet-add').click();
  await expect(page.getByTestId('cabinet-dialog')).toHaveCount(0);
  await saved(page);
  const id = await projectId(page);
  await doorHoles(request, id, cups);
  await page.goto(`/projeler/${id}?adim=parcalar`);
  await wizardReady(page, 'parcalar');
  await nest(page);
  await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 30_000 });
  await goStep(page, 'dizilim');
  await page.getByTestId('view-3d').click();
  await expect(page.getByTestId('preview3d')).toHaveAttribute('data-ready', 'true', {
    timeout: 30_000,
  });
  const toggle = page.getByTestId('preview3d-assembly');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  await expect(page.getByTestId('preview3d-assembly-canvas')).toBeVisible();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

test('single door, handle holes only: assembly renders (screenshot)', async ({ page, request }) => {
  test.setTimeout(150_000);
  await assembly(page, request, false, 'tek-kapak-kulp');
});

test('single door, handle holes + hinge cup: assembly renders (screenshot)', async ({
  page,
  request,
}) => {
  test.setTimeout(150_000);
  await assembly(page, request, true, 'tek-kapak-kulp-mentese');
});
