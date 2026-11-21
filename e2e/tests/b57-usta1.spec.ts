import { expect, test, type APIRequestContext } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { openNewProject, paste, projectId, saved } from './wizard-helpers';

/**
 * B57 (usta 1 user test, before the field test).
 * T317 (D-106): "Sol / sağ kapak yap" turns a door row of 2 into a left row and a mirrored right
 * row (holes mirrored left ↔ right), one undo step.
 */
const ins = tr.editor.inspector;

type Stored = {
  revision: number;
  project: {
    parts: {
      id: string;
      name: string;
      qty: number;
      note?: string;
      grain: { angle: number };
      params: { w: number; h: number };
      holes: { id: string; cx: number; cy: number }[];
    }[];
  };
};

async function stored(request: APIRequestContext, id: string): Promise<Stored> {
  return (await (await request.get(`/api/projects/${id}`)).json()) as Stored;
}

test('T317: Sol / sağ kapak yap gives a mirrored second row; undo restores', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await paste(page, ['Parça adı\tEn\tBoy\tAdet', 'Kapak\t400\t700\t2'].join('\n'), 1);
  await saved(page);
  const id = await projectId(page);
  // A handle hole near the right edge (as the usta's "Kulp 128, sağ kenar").
  const cur = await stored(request, id);
  const part = cur.project.parts[0];
  if (!part) throw new Error('no part');
  (part.holes as unknown[]) = [{ id: 'k1', type: 'through', tool: 1, d: 5, cx: 365, cy: 580 }];
  const res = await request.put(`/api/projects/${id}`, {
    data: { project: cur.project, baseRevision: cur.revision, commands: [] },
  });
  expect(res.status(), await res.text()).toBe(200);
  await page.reload();
  await page.getByTestId('parts-view-drawing').click();
  await expect(page.getByTestId('editor-canvas')).toHaveAttribute('data-view', /\d/);
  await page.getByTestId('editor-part-list').getByRole('button').first().click();
  const block = page.getByTestId('editor-mirror-pair');
  await expect(block.getByRole('heading', { name: ins.mirrorPair.title })).toBeVisible();
  await page.getByTestId('editor-mirror-pair-make').click();
  await saved(page);
  const after = (await stored(request, id)).project.parts;
  expect(after.map((p) => [p.name, p.qty])).toEqual([
    ['Kapak', 1],
    ['Kapak', 1],
  ]);
  expect(after[1]?.note).toBe(ins.mirrorPair.note);
  expect(after[0]?.holes.map((h) => [h.cx, h.cy])).toEqual([[365, 580]]);
  expect(after[1]?.holes.map((h) => [h.cx, h.cy])).toEqual([[35, 580]]);
  // A part of qty 1 has no pair block.
  await page.getByTestId('editor-part-list').getByRole('button').first().click();
  await expect(page.getByTestId('editor-mirror-pair')).toHaveCount(0);
  // One undo step.
  await page.getByTestId('wizard-undo').click();
  await saved(page);
  expect((await stored(request, id)).project.parts.map((p) => p.qty)).toEqual([2]);
});
