import { expect, test, type APIRequestContext } from '@playwright/test';
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

// T277 (B15 tester finding): an engraved open line that leaves its part (100 → 600 on a 300 mm
// part) is an error named "Kapak · Çizgi 1" with the red dot on Parçalar; the Simülasyon box
// names it and opens the part. A line well inside passes.

async function setLines(request: APIRequestContext, id: string, lines: unknown[]) {
  const cur = (await (await request.get(`/api/projects/${id}`)).json()) as {
    revision: number;
    project: { parts: { name: string; lines?: unknown[] }[] };
  };
  const part = cur.project.parts.find((p) => p.name === 'Kapak');
  if (!part) throw new Error('no Kapak');
  part.lines = lines;
  const res = await request.put(`/api/projects/${id}`, {
    data: { project: cur.project, baseRevision: cur.revision, commands: [] },
  });
  expect(res.status()).toBe(200);
}

const line = (x0: number, x1: number) => ({
  vertices: [
    { x: x0, y: 100, bulge: 0 },
    { x: x1, y: 100, bulge: 0 },
  ],
  op: { kind: 'online', depth: 1 },
});

test('T277: a line past its part is caught and named; a line inside passes', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await paste(page, 'Ad\tEn\tBoy\tAdet\nKapak\t300\t400\t1', 1);
  await saved(page);
  const id = await projectId(page);

  await setLines(request, id, [line(100, 600)]);
  await page.goto(`/projeler/${id}?adim=parcalar`);
  await wizardReady(page, 'parcalar');
  await expect(page.getByTestId('wizard-step-parcalar')).toHaveAttribute('data-error', '');
  await page.getByTestId('cut-list-issue-chip').click();
  await expect(
    page.getByTestId('validation-panel').locator('[data-code="LINE_OUTSIDE_PART"]'),
  ).toContainText(fill(tr.wizard.issues.lineNamed, { name: 'Kapak', k: 1 }));
  await page.keyboard.press('Escape');

  await goStep(page, 'dizilim');
  await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
  await goStep(page, 'simulasyon');
  const blocked = page.getByTestId('sim-blocked');
  await expect(blocked).toBeVisible({ timeout: 30_000 });
  await expect(blocked.getByTestId('violation-place')).toHaveText(
    fill(tr.simulation.blocked.linePlace, { name: 'Kapak', n: 1 }),
  );
  await expect(blocked.getByRole('link', { name: tr.simulation.machine.link })).toHaveCount(0);
  await blocked.getByTestId('violation-open-part').click();
  await wizardReady(page, 'parcalar');
  await expect(page).toHaveURL(/gorunum=cizim/);

  await setLines(request, id, [line(100, 200)]);
  await page.goto(`/projeler/${id}?adim=parcalar`);
  await wizardReady(page, 'parcalar');
  await expect(page.getByTestId('wizard-step-parcalar')).not.toHaveAttribute('data-error', '');
});
