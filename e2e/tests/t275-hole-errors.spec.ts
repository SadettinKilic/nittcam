import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  fill,
  goStep,
  openNewProject,
  paste,
  projectId,
  saved,
  wizardReady,
} from './wizard-helpers';

// T275 (CTO review #7 B): hole errors are caught where the hole is drawn (B13a / T270 pattern):
// a Ø5 hole with the Ø8 tool, a tool the machine lacks (T9) and a blind depth equal to the
// thickness are errors under their hole rows, the red dot sits on Parçalar on every step, the
// Simülasyon and Dışa aktar boxes name "Kapak · Delik n" and open the part on the board.

/** Gives the part "Kapak" these holes (part frame) through the API. */
async function setHoles(request: APIRequestContext, id: string, holes: unknown[]) {
  const cur = (await (await request.get(`/api/projects/${id}`)).json()) as {
    revision: number;
    project: { parts: { name: string; holes: unknown[] }[] };
  };
  const part = cur.project.parts.find((p) => p.name === 'Kapak');
  if (!part) throw new Error('no Kapak');
  part.holes = holes;
  const res = await request.put(`/api/projects/${id}`, {
    data: { project: cur.project, baseRevision: cur.revision, commands: [] },
  });
  expect(res.status()).toBe(200);
}

async function axeClean(page: Page) {
  const res = await new AxeBuilder({ page }).analyze();
  const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
}

test('T275: hole errors are named on every step and open on the board', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await paste(page, 'Ad\tEn\tBoy\tAdet\nKapak\t596\t716\t1', 1);
  await saved(page);
  const id = await projectId(page);

  await setHoles(request, id, [
    { id: 'h1', type: 'through', d: 5, cx: 100, cy: 100, tool: 2 },
    { id: 'h2', type: 'through', d: 10, cx: 200, cy: 100, tool: 9 },
    { id: 'h3', type: 'pocket', d: 35, cx: 300, cy: 300, depth: 18, tool: 2 },
  ]);
  await page.goto(`/projeler/${id}?adim=parcalar`);
  await wizardReady(page, 'parcalar');

  // Parçalar: red dot; the panel names every hole.
  await expect(page.getByTestId('wizard-step-parcalar')).toHaveAttribute('data-error', '');
  await page.getByTestId('cut-list-issue-chip').click();
  const panel = page.getByTestId('validation-panel');
  for (const [k, code] of [
    [1, 'HOLE_SMALLER_THAN_TOOL'],
    [2, 'TOOL_NOT_IN_PROFILE'],
    [3, 'HOLE_DEPTH_NOT_BELOW_THICKNESS'],
  ] as const) {
    await expect(panel.locator(`[data-code="${code}"]`)).toContainText(
      fill(tr.wizard.issues.holeNamed, { name: 'Kapak', k }),
    );
  }
  await page.keyboard.press('Escape');

  // Dizilim: the dot stays.
  await goStep(page, 'dizilim');
  await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('wizard-step-parcalar')).toHaveAttribute('data-error', '');

  // Simülasyon: one named line per hole; Makineler stays as a second link (tool fixes).
  await goStep(page, 'simulasyon');
  const blocked = page.getByTestId('sim-blocked');
  await expect(blocked).toBeVisible({ timeout: 30_000 });
  await expect(blocked.getByTestId('violation-place')).toHaveText([
    fill(tr.simulation.blocked.holePlace, { name: 'Kapak', n: 1 }),
    fill(tr.simulation.blocked.holePlace, { name: 'Kapak', n: 2 }),
    fill(tr.simulation.blocked.holePlace, { name: 'Kapak', n: 3 }),
  ]);
  await expect(blocked.getByTestId('violation-open-part')).toHaveCount(3);
  await expect(blocked.getByRole('link', { name: tr.simulation.machine.link })).toHaveCount(1);
  await axeClean(page);

  // Dışa aktar: the same naming.
  await goStep(page, 'export');
  const places = page.getByTestId('export-violation-place');
  await expect(places).toHaveCount(3, { timeout: 30_000 });
  expect((await places.allTextContents()).map((s) => s.replace(/:\s*$/, '')).sort()).toEqual(
    [1, 2, 3].map((n) => fill(tr.wizard.export.holePlace, { name: 'Kapak', n })),
  );
  await expect(page.getByTestId('wizard-step-parcalar')).toHaveAttribute('data-error', '');

  // "Çizimde aç" opens Parçalar → Çizim with Kapak selected and the errors under the hole rows.
  await goStep(page, 'simulasyon');
  await page.getByTestId('violation-open-part').nth(2).click();
  await wizardReady(page, 'parcalar');
  await expect(page).toHaveURL(/gorunum=cizim/);
  await expect(page.getByTestId('prop-hole-0')).toHaveAttribute(
    'data-error',
    'HOLE_SMALLER_THAN_TOOL',
  );
  await expect(page.getByTestId('prop-hole-0-error')).toHaveText(
    fill(tr.editor.inspector.hole.errors.HOLE_SMALLER_THAN_TOOL, {
      n: 1,
      d: '5',
      tool: 2,
      td: '8',
    }),
  );
  await expect(page.getByTestId('prop-hole-1-error')).toHaveText(
    fill(tr.editor.inspector.hole.errors.TOOL_NOT_IN_PROFILE, { n: 2, tool: 9 }),
  );
  await expect(page.getByTestId('prop-hole-2-error')).toBeInViewport();
  await axeClean(page);

  // Fixing the holes clears the errors everywhere.
  for (let i = 0; i < 3; i++) await page.getByTestId('prop-hole-0-remove').click();
  await expect(page.getByTestId('prop-group-holes')).toHaveCount(0);
  await expect(page.getByTestId('wizard-step-parcalar')).not.toHaveAttribute('data-error', '');
});
