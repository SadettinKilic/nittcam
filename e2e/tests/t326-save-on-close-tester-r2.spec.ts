import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { KITCHEN, openNewProject, paste, projectId, saved, wizardReady } from './wizard-helpers';

/**
 * T326 tester round 2 (B60, Web Locks): a crashed tab's queue is taken over at once (0 / 5 / 20 s),
 * replayed before the first local edit; two live tabs never take each other's queue; a queue the
 * server has moved past is parked and offered ("Değişiklikleri uygula / sil"), never dropped.
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

async function savedBoard(page: Page) {
  await openNewProject(page, 'parcalar');
  await paste(page, KITCHEN, 5);
  const id = await projectId(page);
  await saved(page);
  return { id, canvas: await board(page) };
}

async function open(ctx: BrowserContext, id: string): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(`/projeler/${id}?adim=parcalar`);
  await wizardReady(page, 'parcalar');
  return page;
}

/** Draws one part with saves blocked, then crashes the tab (no pagehide, no keepalive). */
async function crashAfterEdit(page: Page, id: string, canvas: Locator) {
  await page.route(`**/api/projects/${id}`, (route) =>
    route.request().method() === 'PUT' ? route.abort('internetdisconnected') : route.continue(),
  );
  await drawRect(page, canvas, 0.3, 596, 716);
  await page.goto('chrome://crash').catch(() => undefined);
}

test.describe('T326 tester r2: Web Locks takeover and parked changes', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.setTimeout(150_000);

  for (const wait of [0, 5_000, 20_000])
    for (const edit of [false, true])
      test(`crash, reopen after ${wait / 1000} s, ${edit ? 'edit there' : 'no edit'}: crashed part once`, async ({
        page,
        context,
      }) => {
        const { id, canvas } = await savedBoard(page);
        const before = await server(context, id);
        await crashAfterEdit(page, id, canvas);
        if (wait) await new Promise((r) => setTimeout(r, wait));
        const p2 = await open(context, id);
        await saved(p2);
        await expect.poll(async () => (await server(context, id)).parts.length).toBe(6);
        if (edit) {
          const c2 = await board(p2);
          await drawRect(p2, c2, 0.6, 300, 200);
          await saved(p2);
        }
        const want = edit ? 7 : 6;
        await expect.poll(async () => (await server(context, id)).parts.length).toBe(want);
        await p2.close();
        // Nothing left behind: a later open applies nothing twice.
        const p3 = await open(context, id);
        await saved(p3);
        await expect(p3.getByTestId('parked-changes')).toHaveCount(0);
        const end = await server(context, id);
        expect(end.parts).toHaveLength(want);
        expect(new Set(end.parts).size).toBe(end.parts.length);
        expect(end.revision).toBe(before.revision + (edit ? 2 : 1));
      });

  for (const fresh of [true, false])
    test(`two live tabs (A ${fresh ? 'created the project in this tab' : 'opened it from its address'}): B never takes A’s unsent queue; after A crashes, B takes it once`, async ({
      page: first,
      context,
    }) => {
      const made = await savedBoard(first);
      const id = made.id;
      let page = first;
      let canvas = made.canvas;
      if (!fresh) {
        await first.close();
        page = await open(context, id);
        await saved(page);
        canvas = await board(page);
      }
      const before = await server(context, id);
      await page.route(`**/api/projects/${id}`, (route) =>
        route.request().method() === 'PUT' ? route.abort('internetdisconnected') : route.continue(),
      );
      await drawRect(page, canvas, 0.3, 596, 716); // A: unsent
      const b = await open(context, id);
      await saved(b);
      await new Promise((r) => setTimeout(r, 1500));
      // B did not take A's change (A is alive).
      expect((await server(context, id)).parts).toHaveLength(5);
      await expect(page.getByTestId('editor-part-list').getByRole('button')).toHaveCount(6);
      // A goes away without its save getting through (crash): B takes over and applies it once.
      await page.goto('chrome://crash').catch(() => undefined);
      await expect
        .poll(async () => (await server(context, id)).parts.length, { timeout: 20_000 })
        .toBe(6);
      await new Promise((r) => setTimeout(r, 1500));
      const end = await server(context, id);
      expect(end.parts).toHaveLength(6);
      expect(end.revision).toBe(before.revision + 1);
      await b.close();
    });

  test('a queue the server moved past is parked: delete asks, apply adds once (rev +1)', async ({
    page,
    context,
    browser,
  }) => {
    const { id, canvas } = await savedBoard(page);
    await crashAfterEdit(page, id, canvas); // this browser keeps the unsent part (base rev r)
    // Another computer saves a change first (rev r+1).
    const other = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const o = await open(other, id);
    await saved(o);
    const oc = await board(o);
    await drawRect(o, oc, 0.6, 300, 200);
    await saved(o);
    await other.close();
    const mid = await server(context, id);
    expect(mid.parts).toHaveLength(6);

    const p2 = await open(context, id);
    const parked = p2.getByTestId('parked-changes');
    await expect(parked).toBeVisible({ timeout: 15_000 });
    expect((await server(context, id)).parts).toHaveLength(6); // not applied by itself
    // Delete asks first; cancel keeps it.
    await p2.getByTestId('parked-drop').click();
    const dialog = p2.getByTestId('parked-drop-dialog');
    await expect(dialog).toBeVisible();
    await p2.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(parked).toBeVisible();
    // Apply: the crashed part appears once, one new revision.
    await p2.getByTestId('parked-apply').click();
    await expect(parked).toHaveCount(0);
    await saved(p2);
    await expect.poll(async () => (await server(context, id)).parts.length).toBe(7);
    const end = await server(context, id);
    expect(end.revision).toBe(mid.revision + 1);
    // Both new parts are auto-named "Parça 6" (one per computer): count only.
    await p2.close();
    const p3 = await open(context, id);
    await saved(p3);
    await expect(p3.getByTestId('parked-changes')).toHaveCount(0);
    expect((await server(context, id)).parts).toHaveLength(7);
  });

  test('parked changes deleted after the confirmation: gone, server untouched', async ({
    page,
    context,
    browser,
  }) => {
    const { id, canvas } = await savedBoard(page);
    await crashAfterEdit(page, id, canvas);
    const other = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const o = await open(other, id);
    await saved(o);
    await drawRect(o, await board(o), 0.6, 300, 200);
    await saved(o);
    await other.close();
    const mid = await server(context, id);
    const p2 = await open(context, id);
    await expect(p2.getByTestId('parked-changes')).toBeVisible({ timeout: 15_000 });
    await p2.getByTestId('parked-drop').click();
    await p2.getByTestId('parked-drop-confirm').click();
    await expect(p2.getByTestId('parked-changes')).toHaveCount(0);
    await p2.reload();
    await wizardReady(p2, 'parcalar');
    await expect(p2.getByTestId('parked-changes')).toHaveCount(0);
    const end = await server(context, id);
    expect(end).toEqual(mid);
  });
});
