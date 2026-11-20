import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  fill,
  openNewProject,
  paste,
  pickOption,
  projectId,
  saved,
  wizardReady,
} from './wizard-helpers';

// B50 (polish P1, CTO #5–#8): holes as collapsed summary rows under "Parça", "Ortasına köşe ekle"
// on an edge, Shift+F zooms to the selection.
const ins = tr.editor.inspector;

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

async function openKapak(page: Page, request: APIRequestContext, holes: unknown[]) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await paste(page, 'Ad\tEn\tBoy\tAdet\nKapak\t596\t716\t1', 1);
  await saved(page);
  const id = await projectId(page);
  await setHoles(request, id, holes);
  await page.goto(`/projeler/${id}?adim=parcalar&gorunum=cizim`);
  await wizardReady(page, 'parcalar');
  await expect(page.getByTestId('editor-canvas')).toHaveAttribute('data-view', /\d/);
  await page.getByTestId('editor-part-list').getByRole('button').first().click();
}

test('B50: holes are summary rows, the newest open, a toggle opens another', async ({
  page,
  request,
}) => {
  await openKapak(page, request, [
    { id: 'h1', type: 'through', d: 8, cx: 100, cy: 100, tool: 2 },
    { id: 'h2', type: 'pocket', d: 35, depth: 12, cx: 22.5, cy: 108, tool: 2 },
    { id: 'h3', type: 'through', d: 10, cx: 300, cy: 300, tool: 2 },
  ]);
  const first = page.getByTestId('prop-hole-0');
  await expect(first).toHaveAttribute('data-open', 'false');
  await expect(first).toContainText(`${ins.hole.type.through} · Ø8 · T2`);
  await expect(page.getByTestId('prop-hole-1')).toContainText('Ø35 · 12 mm · T2');
  await expect(page.getByTestId('prop-hole-2')).toHaveAttribute('data-open', 'true');
  await expect(page.getByTestId('prop-hole-0-d')).toBeHidden();
  await page.getByTestId('prop-hole-0-toggle').click();
  await expect(page.getByTestId('prop-hole-0-d')).toBeVisible();
  // The group sits right under "Parça", before "Damar".
  const holesTop = (await page.getByTestId('prop-group-holes').boundingBox())?.y ?? 0;
  const grainTop = (await page.getByTestId('prop-group-grain').boundingBox())?.y ?? 0;
  expect(holesTop).toBeLessThan(grainTop);
});

test('B50: "Ortasına köşe ekle" adds a corner and picks it; Shift+F zooms in', async ({
  page,
  request,
}) => {
  await openKapak(page, request, []);
  const canvas = page.getByTestId('editor-canvas');
  const scale = async () => Number(((await canvas.getAttribute('data-view')) ?? '0').split(',')[0]);
  await canvas.focus();
  await page.keyboard.press('-');
  await page.keyboard.press('-');
  await expect.poll(scale).toBeLessThan(1);
  const before = await scale();
  await page.keyboard.press('Shift+F');
  await expect.poll(scale).toBeGreaterThan(before);

  await pickOption(page.getByTestId('prop-segment-pick'), fill(ins.segmentN, { n: 1 }));
  await page.getByTestId('prop-seg-split').click();
  await expect(page.getByTestId('prop-vertex-pick')).toHaveAttribute('data-value', '1');
  await expect(page.getByTestId('editor-size')).toHaveText(/596\s*×\s*716/);
});
