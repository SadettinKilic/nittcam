import AxeBuilder from '@axe-core/playwright';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { KITCHEN, openNewProject, paste, projectId, saved, wizardReady } from './wizard-helpers';

/**
 * T326 tester attack (B60): edits made just before a tab closes, crashes, goes offline, reloads or
 * shares the project with a second tab are never lost and never applied twice. Counts are read
 * from the server (`GET /api/projects/:id`: parts and revision) before and after.
 */

interface ServerView {
  parts: string[];
  revision: number;
  lastSaveId: string | null;
}

async function server(ctx: BrowserContext, id: string): Promise<ServerView> {
  const res = await ctx.request.get(`/api/projects/${id}`);
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as {
    project: { parts: { name: string }[] };
    revision: number;
    lastSaveId?: string | null;
  };
  return {
    parts: body.project.parts.map((p) => p.name),
    revision: body.revision,
    lastSaveId: body.lastSaveId ?? null,
  };
}

async function board(page: Page): Promise<Locator> {
  await page.getByTestId('parts-view-drawing').click();
  const canvas = page.getByTestId('editor-canvas');
  await expect(canvas).toHaveAttribute('data-view', /\d/);
  return canvas;
}

async function savedBoard(page: Page, list = KITCHEN, n = 5) {
  await openNewProject(page, 'parcalar');
  await paste(page, list, n);
  const id = await projectId(page);
  await saved(page);
  const canvas = await board(page);
  return { id, canvas };
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
  // Drawn over a kitchen part: the editor asks 'İç kesim olarak ekle?'; keep it a separate part.
  const asPart = page.getByRole('button', { name: 'Ayrı parça olarak ekle' });
  await expect(parts.nth(n).or(asPart)).toBeVisible();
  if (await asPart.isVisible()) await asPart.click();
}

const partButtons = (page: Page) => page.getByTestId('editor-part-list').getByRole('button');

async function reopen(ctx: BrowserContext, id: string): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(`/projeler/${id}?adim=parcalar`);
  await wizardReady(page, 'parcalar');
  await saved(page);
  return page;
}

test.describe('T326 tester: save on close attacks', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.setTimeout(150_000);

  test('keepalive on close: does page.route see it, does it land, exactly once', async ({
    page,
    context,
  }) => {
    const { id, canvas } = await savedBoard(page);
    const before = await server(context, id);
    let routed = 0;
    await context.route(`**/api/projects/${id}`, (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      routed++;
      return route.abort('internetdisconnected');
    });
    await drawRect(page, canvas, 0.3, 596, 716);
    await expect(partButtons(page)).toHaveCount(6);
    await page.close();
    await new Promise((r) => setTimeout(r, 2000));
    await context.unroute(`**/api/projects/${id}`);
    const afterClose = await server(context, id);
    console.log(
      `[keepalive] routed PUTs=${routed}; server parts after close without reopen=${afterClose.parts.length} (before ${before.parts.length})`,
    );
    await reopen(context, id);
    await expect.poll(async () => (await server(context, id)).parts.length).toBe(6);
    const end = await server(context, id);
    expect(end.parts).toHaveLength(6);
    expect(end.revision).toBe(before.revision + 1);
  });

  test('renderer crash right after drawing: reopened at once, the part comes back once', async ({
    page,
    context,
  }) => {
    const { id, canvas } = await savedBoard(page);
    const before = await server(context, id);
    await page.route(`**/api/projects/${id}`, (route) =>
      route.request().method() === 'PUT' ? route.abort('internetdisconnected') : route.continue(),
    );
    await drawRect(page, canvas, 0.3, 596, 716);
    await expect(partButtons(page)).toHaveCount(6);
    // Crash before the debounce ran: no pagehide, no keepalive.
    await page.goto('chrome://crash').catch(() => undefined);
    const again = await reopen(context, id);
    // Expected: the crashed tab's queue is offered/replayed. Recorded either way.
    const firstLook = (await server(context, id)).parts.length;
    console.log(
      `[crash] server parts right after reopen=${firstLook}; UI parts=${await partButtons(again).count()}`,
    );
    await again.close();
    // After the 15 s live-page window the queue must be taken.
    await new Promise((r) => setTimeout(r, 16_000));
    await reopen(context, id);
    await expect.poll(async () => (await server(context, id)).parts.length).toBe(6);
    const end = await server(context, id);
    expect(end.parts).toHaveLength(6);
    expect(end.revision).toBe(before.revision + 1);
  });

  test('renderer crash, "Aw, Snap" -> reload the same tab at once, edit there: crashed edit kept', async ({
    page,
    context,
  }) => {
    const { id, canvas } = await savedBoard(page);
    const before = await server(context, id);
    await page.route(`**/api/projects/${id}`, (route) =>
      route.request().method() === 'PUT' ? route.abort('internetdisconnected') : route.continue(),
    );
    await drawRect(page, canvas, 0.3, 596, 716);
    await expect(partButtons(page)).toHaveCount(6);
    await page.goto('chrome://crash').catch(() => undefined);
    // A crashed tab cannot be reloaded in Playwright: a new page of the same browser at once.
    const p2 = await reopen(context, id);
    console.log(`[crash-reload] UI parts after reload=${await partButtons(p2).count()}`);
    // The user goes on working in the reloaded tab.
    const c2 = await board(p2);
    await drawRect(p2, c2, 0.6, 300, 200);
    await saved(p2);
    await new Promise((r) => setTimeout(r, 16_000));
    await p2.close();
    await reopen(context, id);
    await new Promise((r) => setTimeout(r, 1500));
    const end = await server(context, id);
    console.log(
      `[crash-reload] end parts=${end.parts.length} rev ${before.revision}->${end.revision}`,
    );
    expect(end.parts).toHaveLength(7);
  });

  test('offline: edit, close, back online in a NEW tab: restored once', async ({
    page,
    context,
  }) => {
    const { id, canvas } = await savedBoard(page);
    const before = await server(context, id);
    await context.setOffline(true);
    await drawRect(page, canvas, 0.3, 596, 716);
    await drawRect(page, canvas, 0.6, 300, 200);
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', /error|saving/, {
      timeout: 15_000,
    });
    await page.close();
    await context.setOffline(false);
    const again = await reopen(context, id);
    await expect.poll(async () => (await server(context, id)).parts.length).toBe(7);
    const end = await server(context, id);
    expect(end.parts).toHaveLength(7);
    expect(end.revision).toBe(before.revision + 1);
    // Undo after a restored queue: the last restored part goes, the server follows.
    await expect(again.getByTestId('wizard-undo')).toBeEnabled();
    await again.getByTestId('wizard-undo').click();
    await expect.poll(async () => (await server(context, id)).parts.length).toBe(6);
    await saved(again);
    await expect(partButtons(again)).toHaveCount(6);
  });

  test('reload while the save is on the way (reached the server, no answer): once', async ({
    page,
    context,
  }) => {
    const { id, canvas } = await savedBoard(page);
    const before = await server(context, id);
    await page.route(`**/api/projects/${id}`, async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      await route.fetch();
      // never answered
    });
    await drawRect(page, canvas, 0.3, 596, 716);
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saving', {
      timeout: 10_000,
    });
    await page.unroute(`**/api/projects/${id}`);
    await page.reload();
    await wizardReady(page);
    await saved(page);
    await expect.poll(async () => (await server(context, id)).parts.length).toBe(6);
    const end = await server(context, id);
    expect(end.parts).toHaveLength(6);
    expect(end.revision).toBe(before.revision + 1);
  });

  test('two tabs editing in turn: nothing overwritten, nothing twice', async ({
    page,
    context,
  }) => {
    const { id, canvas } = await savedBoard(page);
    const b = await reopen(context, id);
    const canvasB = await board(b);
    // A edits and saves.
    await drawRect(page, canvas, 0.3, 596, 716);
    await saved(page);
    expect((await server(context, id)).parts).toHaveLength(6);
    // B is behind: its edit must not overwrite A's part.
    await drawRect(b, canvasB, 0.6, 300, 200);
    await expect(b.getByTestId('save-status')).toHaveAttribute(
      'data-state',
      /conflict|saved|error/,
      { timeout: 15_000 },
    );
    const mid = await server(context, id);
    console.log(
      `[two-tabs] B state=${await b.getByTestId('save-status').getAttribute('data-state')}; server parts=${mid.parts.length} rev=${mid.revision}`,
    );
    expect(mid.parts.length).toBeGreaterThanOrEqual(6);
    // A's part is never lost.
    expect(mid.parts.filter((n) => !/^(Yan|Alt|Raf|Kapak|Arka)/.test(n)).length).toBeGreaterThan(0);
    await b.close();
    await page.close();
    // A third tab with B's stale queue: never overwrites, never duplicates.
    const c = await reopen(context, id);
    const end = await server(context, id);
    expect(end.parts.length).toBe(mid.parts.length);
    expect(new Set(end.parts).size).toBe(end.parts.length);
    await c.close();
  });

  test('large project (save body over 60 KB): edit closed at once comes back on reopen', async ({
    page,
    context,
  }) => {
    const rows = ['Ad\tEn\tBoy\tAdet'];
    for (let i = 0; i < 400; i++) rows.push(`Parca uzun isim ${i}\t${100 + i}\t${50 + i}\t1`);
    let bodyBytes = 0;
    page.on('request', (r) => {
      if (r.url().includes('/api/projects') && ['PUT', 'POST'].includes(r.method())) {
        bodyBytes = Math.max(bodyBytes, Buffer.byteLength(r.postData() ?? ''));
      }
    });
    const { id, canvas } = await savedBoard(page, rows.join('\n'), 400);
    const before = await server(context, id);
    await drawRect(page, canvas, 0.3, 596, 716);
    await page.close();
    console.log(`[large] largest save body=${bodyBytes}`);
    expect(bodyBytes).toBeGreaterThan(60_000);
    await reopen(context, id);
    await expect.poll(async () => (await server(context, id)).parts.length).toBe(401);
    const end = await server(context, id);
    expect(end.revision).toBe(before.revision + 1);
  });

  test('new draft closed inside the debounce (online): one project, its parts, no copy', async ({
    page,
    context,
  }) => {
    const before = (await (await context.request.get('/api/projects')).json()) as { id: string }[];
    await openNewProject(page, 'parcalar');
    await paste(page, 'Ad\tEn\tBoy\tAdet\nDebounceT\t410\t310\t1', 1);
    await page.close();
    const list = await context.newPage();
    await list.goto('/projeler');
    await expect(list.getByTestId('projects-new')).toBeVisible();
    const banner = list.getByTestId('left-draft');
    if (await banner.isVisible()) {
      await banner.getByTestId('left-draft-open').click();
      await wizardReady(list);
      await saved(list);
    }
    await new Promise((r) => setTimeout(r, 1500));
    const after = (await (await context.request.get('/api/projects')).json()) as {
      id: string;
    }[];
    const fresh = after.filter((p) => !before.some((q) => q.id === p.id));
    expect(fresh).toHaveLength(1);
    const freshId = fresh[0]?.id ?? '';
    const s = await server(context, freshId);
    expect(s.parts).toEqual(['DebounceT']);
    // Opened right after creating it, from Projeler: parts are there.
    await list.goto('/projeler');
    await expect(list.getByTestId('left-draft')).toHaveCount(0);
    await list.goto(`/projeler/${freshId}?adim=parcalar`);
    await wizardReady(list, 'parcalar');
    await expect(list.locator('input[value="DebounceT"]').first()).toBeVisible();
  });

  test('browser context closed (not the tab) inside the debounce: where does the edit go', async ({
    browser,
  }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const { id, canvas } = await savedBoard(page);
    const before = await server(ctx, id);
    await drawRect(page, canvas, 0.3, 596, 716);
    await ctx.close();
    const ctx2 = await browser.newContext();
    await new Promise((r) => setTimeout(r, 2000));
    const after = await server(ctx2, id);
    console.log(
      `[ctx-kill] server parts=${after.parts.length} (before ${before.parts.length}) rev ${before.revision}->${after.revision}`,
    );
    expect(after.parts.length).toBeLessThanOrEqual(6);
    await ctx2.close();
  });

  test('"Taslağı sil" confirmed: gone for good, no project made; dialog is axe clean', async ({
    page,
    context,
  }) => {
    const before = (await (await context.request.get('/api/projects')).json()) as { id: string }[];
    // Really offline: page.route does not see the keepalive create sent on close.
    await openNewProject(page, 'parcalar');
    await context.setOffline(true);
    await paste(page, 'Ad\tEn\tBoy\tAdet\nSilinecek\t400\t300\t1', 1);
    await page.close();
    await context.setOffline(false);
    const list = await context.newPage();
    await list.goto('/projeler');
    await expect(list.getByTestId('left-draft')).toBeVisible();
    await list.getByTestId('left-draft-discard').click();
    await expect(list.getByRole('alertdialog')).toBeVisible();
    await list.waitForTimeout(400); // open animation
    const axe = await new AxeBuilder({ page: list }).analyze();
    const bad = axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => v.id)).toEqual([]);
    await list.getByTestId('left-draft-discard-confirm').click();
    await expect(list.getByTestId('left-draft')).toHaveCount(0);
    await list.reload();
    await expect(list.getByTestId('projects-new')).toBeVisible();
    await expect(list.getByTestId('left-draft')).toHaveCount(0);
    const keys = await list.evaluate(() =>
      Object.keys(localStorage).filter((k) => k.startsWith('nittcam.unsent.')),
    );
    expect(keys).toEqual([]);
    const after = (await (await context.request.get('/api/projects')).json()) as { id: string }[];
    expect(after.length).toBe(before.length);
  });

  test('close prompt: none after a completed save', async ({ page }) => {
    const { canvas } = await savedBoard(page);
    await drawRect(page, canvas, 0.3, 596, 716);
    await saved(page);
    const asked: string[] = [];
    page.on('dialog', (d) => {
      asked.push(d.type());
      void d.dismiss();
    });
    await page.close({ runBeforeUnload: true });
    await new Promise((r) => setTimeout(r, 1000));
    expect(asked).toEqual([]);
    expect(page.isClosed()).toBe(true);
  });
});
