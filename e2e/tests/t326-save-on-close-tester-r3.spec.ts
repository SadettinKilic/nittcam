import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { KITCHEN, openNewProject, paste, projectId, saved, wizardReady } from './wizard-helpers';

/**
 * T326 tester round 3 (B60, fix 23eb091: the Web Lock follows the key the queue is stored under).
 * Tab A creates the project and keeps editing with its saves blocked: tab B must not take A's live
 * queue; once A's network is back A saves without a conflict (parts once, revision +1); a later
 * crash of A hands its queue to B exactly once. The cabinet split-off and project-to-project
 * navigation in one tab leave no unsent queue behind.
 */

async function server(ctx: BrowserContext, id: string) {
  const res = await ctx.request.get(`/api/projects/${id}`);
  expect(res.ok()).toBe(true);
  const b = (await res.json()) as { project: { parts: { name: string }[] }; revision: number };
  return { parts: b.project.parts.map((p) => p.name), revision: b.revision };
}

async function board(page: Page): Promise<Locator> {
  await page.getByTestId('parts-view-drawing').click();
  const canvas = page.getByTestId('editor-canvas');
  await expect(canvas).toHaveAttribute('data-view', /\d/);
  return canvas;
}

async function drawRect(page: Page, canvas: Locator, at: number, w: number, h: number) {
  const b = await canvas.boundingBox();
  if (!b) throw new Error('no canvas box');
  const parts = page.getByTestId('editor-part-list').getByRole('button');
  const n = await parts.count();
  await page.getByTestId('editor-tool-rect').click();
  await page.mouse.click(b.x + b.width * 0.7, b.y + b.height * at);
  await expect(page.getByTestId('editor-dynamic-input')).toBeVisible();
  await page.keyboard.type(String(w));
  await page.keyboard.press('Tab');
  await page.keyboard.type(String(h));
  await page.keyboard.press('Enter');
  const asPart = page.getByRole('button', { name: 'Ayrı parça olarak ekle' });
  await expect(parts.nth(n).or(asPart)).toBeVisible();
  if (await asPart.isVisible()) await asPart.click();
}

const blockPuts = (page: Page, id: string) =>
  page.route(`**/api/projects/${id}`, (route) =>
    route.request().method() === 'PUT' ? route.abort('internetdisconnected') : route.continue(),
  );

/** Unsent queues left in this origin's localStorage (key → stored value length). */
async function unsent(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Object.keys(localStorage).filter((k) => {
      if (!k.startsWith('nittcam.unsent.')) return false;
      const v = localStorage.getItem(k) ?? '';
      try {
        const q = JSON.parse(v) as { entries?: unknown[] };
        return (q.entries?.length ?? 0) > 0;
      } catch {
        return v.length > 0;
      }
    }),
  );
}

test.describe('T326 tester r3: lock follows the queue key', () => {
  test.setTimeout(150_000);
  test.use({ viewport: { width: 1440, height: 900 } });

  test('A created the project: B waits; A back online saves without conflict (rev +1); A crashes later, B takes it once', async ({
    page,
    context,
  }) => {
    await openNewProject(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    const id = await projectId(page);
    await saved(page);
    const canvas = await board(page);
    const r0 = (await server(context, id)).revision;

    await blockPuts(page, id);
    await drawRect(page, canvas, 0.3, 596, 716); // A: 6th part, unsent
    const b = await context.newPage();
    await b.goto(`/projeler/${id}?adim=parcalar`);
    await wizardReady(b, 'parcalar');
    await saved(b);
    await new Promise((r) => setTimeout(r, 2000));
    let s = await server(context, id);
    expect(s.parts).toHaveLength(5); // B did not take A's live queue
    expect(s.revision).toBe(r0);
    await expect(b.getByTestId('parked-changes')).toHaveCount(0);

    // A's network is back: A saves by itself, no conflict, part once, revision +1.
    await page.unroute(`**/api/projects/${id}`);
    await expect
      .poll(async () => (await server(context, id)).parts.length, { timeout: 45_000 })
      .toBe(6);
    await saved(page);
    await expect(page.getByTestId('conflict')).toHaveCount(0);
    s = await server(context, id);
    expect(s.revision).toBe(r0 + 1);
    await expect(page.getByTestId('editor-part-list').getByRole('button')).toHaveCount(6);

    // A edits again with saves blocked, then crashes: B takes the queue once.
    await blockPuts(page, id);
    await drawRect(page, canvas, 0.6, 300, 200);
    await expect(page.getByTestId('editor-part-list').getByRole('button')).toHaveCount(7);
    await new Promise((r) => setTimeout(r, 1500));
    expect((await server(context, id)).parts).toHaveLength(6);
    await page.goto('chrome://crash').catch(() => undefined);
    // B is stale (it still shows 5 parts, server rev r0 + 1): it either applies A's queue at once
    // or parks it and offers it; "Uygula" then adds the part once, keeping A's earlier save.
    const parked = b.getByTestId('parked-changes');
    await expect
      .poll(
        async () => (await server(context, id)).parts.length === 7 || (await parked.isVisible()),
        {
          timeout: 25_000,
        },
      )
      .toBe(true);
    if ((await server(context, id)).parts.length !== 7) {
      // Round 3 finding: B parks a queue whose base (r0 + 1) is the server's revision, because B
      // itself is still on r0; "Uygula" then replays onto B's stale state and the save conflicts
      // ("Proje başka bir yerde değişti"); "Sunucudaki son hali yükle" then drops the crashed edit.
      await b.getByTestId('parked-apply').click();
      await expect
        .poll(async () => (await server(context, id)).parts.length, { timeout: 20_000 })
        .toBe(7);
      await saved(b);
      await expect(b.getByTestId('editor-part-list').getByRole('button')).toHaveCount(7);
    }
    await new Promise((r) => setTimeout(r, 2000));
    s = await server(context, id);
    expect(s.parts).toHaveLength(7);
    expect(s.revision).toBe(r0 + 2);
    await expect(b.getByTestId('conflict')).toHaveCount(0);
    // Reopening later applies nothing twice and offers nothing.
    const c = await context.newPage();
    await c.goto(`/projeler/${id}?adim=parcalar`);
    await wizardReady(c, 'parcalar');
    await new Promise((r) => setTimeout(r, 2000));
    await expect(c.getByTestId('parked-changes')).toHaveCount(0);
    expect((await server(context, id)).parts).toHaveLength(7);
  });

  test('cabinet split-off from a project created in this tab leaves no edit behind', async ({
    page,
    context,
  }) => {
    const c = tr.cutList.cabinet;
    const name = `Split ${Math.random().toString(36).slice(2, 8)}`;
    await openNewProject(page, 'parcalar');
    await paste(page, ['Parça adı\tEn\tBoy\tAdet', 'Raf\t500\t300\t2'].join('\n'), 1);
    const nameField = page.getByTestId('project-name');
    await nameField.fill(name);
    await nameField.press('Enter');
    await saved(page);
    const sourceId = await projectId(page);

    await page.getByTestId('cabinet-open').click();
    await page.getByTestId('cabinet-split').click();
    await expect(page.getByTestId('cabinet-split-thickness')).toHaveValue('8');
    await page.getByTestId('cabinet-add').click();
    const toast = page.locator('[data-sonner-toast]').filter({ hasText: c.split.open });
    await expect(toast).toBeVisible();
    await saved(page);
    const src = await server(context, sourceId);
    expect(src.parts.length).toBeGreaterThan(1); // Raf + the cabinet's 18 mm rows
    await toast.getByRole('button', { name: c.split.open }).click();
    await expect(page).not.toHaveURL(new RegExp(sourceId));
    const newId = await projectId(page);
    await wizardReady(page, 'parcalar');
    await saved(page);
    const made = await server(context, newId);
    expect(made.parts).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 1500));
    expect(await unsent(page)).toEqual([]);

    // Back to the source: nothing parked, nothing applied twice.
    await page.getByTestId('project-links-source').getByRole('link').click();
    await expect(page).toHaveURL(new RegExp(`/projeler/${sourceId}`));
    await wizardReady(page);
    await new Promise((r) => setTimeout(r, 1500));
    await expect(page.getByTestId('parked-changes')).toHaveCount(0);
    expect(await server(context, sourceId)).toEqual(src);
    expect(await server(context, newId)).toEqual(made);
    const list = await context.newPage();
    await list.goto('/projeler');
    await expect(list.getByTestId('projects-new')).toBeVisible();
    await new Promise((r) => setTimeout(r, 1500));
    await expect(list.getByTestId('left-draft')).toHaveCount(0);
  });

  test('project to project in one tab: each edit lands in its own project, nothing left behind', async ({
    page,
    context,
  }) => {
    // Project X created in this tab, Y created in another page.
    const other = await context.newPage();
    await openNewProject(other, 'parcalar');
    await paste(other, 'Ad\tEn\tBoy\tAdet\nYPart\t400\t300\t1', 1);
    const yId = await projectId(other);
    await saved(other);
    await other.close();

    await openNewProject(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    const xId = await projectId(page);
    await saved(page);
    let canvas = await board(page);
    await drawRect(page, canvas, 0.3, 596, 716); // edit in X, then leave at once (debounce)
    await page.goto(`/projeler/${yId}?adim=parcalar`);
    await wizardReady(page, 'parcalar');
    await saved(page);
    canvas = await board(page);
    await drawRect(page, canvas, 0.3, 500, 400); // edit in Y
    await saved(page);
    await page.goto(`/projeler/${xId}?adim=parcalar`);
    await wizardReady(page, 'parcalar');
    await saved(page);
    await new Promise((r) => setTimeout(r, 2000));
    await expect(page.getByTestId('parked-changes')).toHaveCount(0);
    const x = await server(context, xId);
    const y = await server(context, yId);
    expect(x.parts).toHaveLength(6);
    expect(y.parts).toHaveLength(2);
    expect(y.parts).toContain('YPart');
    expect(await unsent(page)).toEqual([]);
    const list = await context.newPage();
    await list.goto('/projeler');
    await expect(list.getByTestId('projects-new')).toBeVisible();
    await new Promise((r) => setTimeout(r, 1500));
    await expect(list.getByTestId('left-draft')).toHaveCount(0);
  });
});
