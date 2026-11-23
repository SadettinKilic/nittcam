import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { KITCHEN, openNewProject, paste, projectId, saved, wizardReady } from './wizard-helpers';

/**
 * T326 tester round 4 (B60, fix d7ec4ac: the takeover decides against the server's revision and
 * lastSaveId read at takeover time). One test per row of the developer's state table, built with
 * real tabs (two pages in one context share localStorage and Web Locks; a crash is
 * `chrome://crash`, which sends no pagehide), plus the parked flow, three tabs, a reload during the
 * first save, a second browser context, and the single-tab basics. Every test ends with "each part
 * exactly once on the server, revision as expected".
 *
 * ROUND 4 PARTIAL (paydos 2026-11-23): all tests ran on d7ec4ac. Every one passes except
 * "a second tab (not the lock holder) crashes with an unsent edit", which FAILS on purpose: it
 * reproduces a real loss (finding F1 on PR #192). Remove the console.log in row 6 when finishing.
 */

interface Server {
  parts: string[];
  dims: string[];
  revision: number;
}

async function server(ctx: BrowserContext, id: string): Promise<Server> {
  const res = await ctx.request.get(`/api/projects/${id}`);
  expect(res.ok()).toBe(true);
  const b = (await res.json()) as {
    project: {
      parts: {
        name: string;
        params?: { w: number; h: number };
        outline?: { x: number; y: number }[];
      }[];
    };
    revision: number;
  };
  const dim = (p: (typeof b.project.parts)[number]) => {
    if (p.params) return `${Math.round(p.params.w)}x${Math.round(p.params.h)}`;
    const xs = (p.outline ?? []).map((v) => v.x);
    const ys = (p.outline ?? []).map((v) => v.y);
    return `${Math.round(Math.max(...xs) - Math.min(...xs))}x${Math.round(Math.max(...ys) - Math.min(...ys))}`;
  };
  return {
    parts: b.project.parts.map((p) => p.name),
    dims: b.project.parts.map(dim),
    revision: b.revision,
  };
}

/** How many parts on the server have this size (either way round). */
const countDim = (s: Server, w: number, h: number) =>
  s.dims.filter((d) => d === `${w}x${h}` || d === `${h}x${w}`).length;

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

async function savedProject(page: Page) {
  await openNewProject(page, 'parcalar');
  await paste(page, KITCHEN, 5);
  const id = await projectId(page);
  await saved(page);
  return id;
}

async function open(ctx: BrowserContext, id: string): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(`/projeler/${id}?adim=parcalar`);
  await wizardReady(page, 'parcalar');
  return page;
}

const url = (id: string) => `**/api/projects/${id}`;
const blockPuts = (page: Page, id: string) =>
  page.route(url(id), (route) =>
    route.request().method() === 'PUT' ? route.abort('internetdisconnected') : route.continue(),
  );

/** The tab dies without pagehide (no keepalive), as a renderer crash or a killed browser. */
async function crash(page: Page) {
  await page.goto('chrome://crash').catch(() => undefined);
}

/** A blocked edit in `page`, kept only in localStorage, then the page crashes. */
async function crashAfterEdit(page: Page, id: string, w: number, h: number) {
  await blockPuts(page, id);
  const canvas = await board(page);
  await drawRect(page, canvas, 0.3, w, h);
  await new Promise((r) => setTimeout(r, 1500)); // debounce + stored queue
  await crash(page);
}

const settle = () => new Promise((r) => setTimeout(r, 2500));

async function otherBrowser(browser: Browser, baseURL: string | undefined) {
  return browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL });
}

/** Saves one drawn part from a second browser (another computer): the server moves on. */
async function foreignEdit(
  browser: Browser,
  baseURL: string | undefined,
  id: string,
  w: number,
  h: number,
) {
  const other = await otherBrowser(browser, baseURL);
  const o = await open(other, id);
  await saved(o);
  await drawRect(o, await board(o), 0.6, w, h);
  await saved(o);
  await other.close();
}

async function noParkedAfterReopen(ctx: BrowserContext, id: string) {
  const p = await open(ctx, id);
  await saved(p);
  await settle();
  await expect(p.getByTestId('parked-changes')).toHaveCount(0);
  await p.close();
}

test.describe('T326 tester r4: state table rows with real tabs', () => {
  test.setTimeout(180_000);
  test.use({ viewport: { width: 1440, height: 900 } });

  test('row 2: queue base = server, taking tab current with nothing unsent → replay once', async ({
    page,
    context,
  }) => {
    const id = await savedProject(page);
    const b = await open(context, id);
    await saved(b);
    const r0 = (await server(context, id)).revision;
    await crashAfterEdit(page, id, 611, 311);
    await expect.poll(async () => countDim(await server(context, id), 611, 311)).toBe(1);
    await saved(b);
    await settle();
    const s = await server(context, id);
    expect(countDim(s, 611, 311)).toBe(1);
    expect(s.parts).toHaveLength(6);
    expect(s.revision).toBe(r0 + 1);
    await expect(b.getByTestId('parked-changes')).toHaveCount(0);
    await expect(b.getByTestId('conflict')).toHaveCount(0);
    await expect(b.getByTestId('cut-list-count')).toContainText('toplam 31 parça');
    await noParkedAfterReopen(context, id);
  });

  test('row 3: queue base = server, taking tab stale → reload, then replay once', async ({
    page,
    context,
  }) => {
    const id = await savedProject(page);
    const b = await open(context, id); // B on r0
    await saved(b);
    const r0 = (await server(context, id)).revision;
    // A saves one part (r0 + 1): B does not see it.
    let canvas = await board(page);
    await drawRect(page, canvas, 0.2, 612, 312);
    await saved(page);
    expect((await server(context, id)).revision).toBe(r0 + 1);
    // A's next edit is blocked, then A crashes (queue base r0 + 1 = server).
    await blockPuts(page, id);
    canvas = await board(page);
    await drawRect(page, canvas, 0.5, 613, 313);
    await new Promise((r) => setTimeout(r, 1500));
    await crash(page);
    await expect.poll(async () => countDim(await server(context, id), 613, 313)).toBe(1);
    await saved(b);
    await settle();
    const s = await server(context, id);
    expect(countDim(s, 612, 312)).toBe(1);
    expect(countDim(s, 613, 313)).toBe(1);
    expect(s.revision).toBe(r0 + 2);
    await expect(b.getByTestId('conflict')).toHaveCount(0);
    await expect(b.getByTestId('parked-changes')).toHaveCount(0);
    await expect(b.getByTestId('editor-part-list').getByRole('button')).toHaveCount(7);
    await noParkedAfterReopen(context, id);
  });

  for (const taker of ['current', 'stale'] as const) {
    test(`rows 4/5: own save ahead (reached the server, answer lost), taking tab ${taker} → only the entries after the unit`, async ({
      page,
      context,
    }) => {
      const id = await savedProject(page);
      const r0 = (await server(context, id)).revision;
      let b: Page | null = taker === 'stale' ? await open(context, id) : null;
      if (b) await saved(b);
      // A's save reaches the server but the answer is lost.
      await page.route(url(id), async (route) => {
        if (route.request().method() !== 'PUT') return route.continue();
        await route.fetch().catch(() => undefined);
        await route.abort('internetdisconnected');
      });
      let canvas = await board(page);
      await drawRect(page, canvas, 0.2, 614, 314);
      await expect.poll(async () => countDim(await server(context, id), 614, 314)).toBe(1);
      // Then nothing reaches the server any more; A draws one more part and crashes.
      await page.unroute(url(id));
      await blockPuts(page, id);
      canvas = await board(page);
      await drawRect(page, canvas, 0.5, 615, 315);
      await new Promise((r) => setTimeout(r, 1500));
      const mid = await server(context, id);
      expect(countDim(mid, 614, 314)).toBe(1);
      expect(countDim(mid, 615, 315)).toBe(0);
      if (!b) {
        b = await open(context, id); // current: loads the server's newest revision
        await expect(b.getByTestId('editor-part-list')).toBeAttached();
      }
      await crash(page);
      await expect.poll(async () => countDim(await server(context, id), 615, 315)).toBe(1);
      await saved(b);
      await settle();
      const s = await server(context, id);
      expect(countDim(s, 614, 314)).toBe(1);
      expect(countDim(s, 615, 315)).toBe(1);
      expect(s.parts).toHaveLength(7);
      expect(s.revision).toBe(mid.revision + 1);
      expect(mid.revision).toBe(r0 + 1);
      await expect(b.getByTestId('conflict')).toHaveCount(0);
      await expect(b.getByTestId('parked-changes')).toHaveCount(0);
      await noParkedAfterReopen(context, id);
    });
  }

  test('row 6: foreign save ahead → park; conflict on apply keeps it parked; "Sunucudaki son hali yükle" keeps it; apply adds once', async ({
    page,
    context,
    browser,
    baseURL,
  }) => {
    const id = await savedProject(page);
    const b = await open(context, id);
    await saved(b);
    const r0 = (await server(context, id)).revision;
    // A (the lock holder) makes a queue (base r0), another computer saves first, then A crashes:
    // B takes the queue, the server is past its base → park.
    await blockPuts(page, id);
    await drawRect(page, await board(page), 0.3, 617, 317);
    await new Promise((r) => setTimeout(r, 1500));
    await foreignEdit(browser, baseURL, id, 618, 318);
    expect((await server(context, id)).revision).toBe(r0 + 1);
    await crash(page);
    const parked = b.getByTestId('parked-changes');
    await expect(parked).toBeVisible({ timeout: 20_000 });
    await settle();
    expect(countDim(await server(context, id), 617, 317)).toBe(0); // not applied by itself

    // "Uygula" while another computer saves in between → conflict; the changes stay parked.
    let first = true;
    await b.route(url(id), async (route) => {
      if (route.request().method() === 'PUT' && first) {
        first = false;
        await foreignEdit(browser, baseURL, id, 619, 319);
      }
      await route.continue();
    });
    await b.getByTestId('parked-apply').click();
    const conflict = b.getByTestId('conflict');
    const applied = async () => countDim(await server(context, id), 617, 317);
    // Either the stale-tab path reloaded first (then the PUT conflicts) or it applied before the
    // foreign save: both must keep every part exactly once.
    await expect
      .poll(async () => (await conflict.isVisible()) || (await applied()) === 1)
      .toBe(true);
    await b.unroute(url(id));
    if (await conflict.isVisible()) {
      await expect(parked).toBeVisible();
      expect(await applied()).toBe(0);
      await conflict.getByRole('button', { name: tr.wizard.conflict.reload }).click();
      await wizardReady(b, 'parcalar');
      await expect(b.getByTestId('parked-changes')).toBeVisible({ timeout: 20_000 });
      await b.getByTestId('parked-apply').click();
    }
    await expect.poll(applied, { timeout: 30_000 }).toBe(1);
    await saved(b);
    await settle();
    const s = await server(context, id);
    for (const [w, h] of [
      [617, 317],
      [618, 318],
      [619, 319],
    ] as const)
      expect(countDim(s, w, h), `${w}x${h}`).toBe(1);
    expect(s.parts).toHaveLength(8);
    await expect(b.getByTestId('parked-changes')).toHaveCount(0);
    await noParkedAfterReopen(context, id);
  });

  test('a second tab (not the lock holder) crashes with an unsent edit: the edit is not lost', async ({
    page,
    context,
  }) => {
    const id = await savedProject(page); // A creates the project and holds its lock
    const b = await open(context, id);
    await saved(b);
    const r0 = (await server(context, id)).revision;
    await crashAfterEdit(b, id, 624, 324); // B: blocked edit, then B crashes
    await settle();
    const stored = async () =>
      page.evaluate(() =>
        Object.keys(localStorage)
          .filter((k) => k.startsWith('nittcam.unsent.'))
          .map((k) => localStorage.getItem(k) ?? '')
          .join('|'),
      );
    const s1 = await server(context, id);
    const offered = await page.getByTestId('parked-changes').count();
    test.info().annotations.push({
      type: 'after B crash',
      description: `server 624: ${countDim(s1, 624, 324)}, parked in A: ${offered}, stored: ${(await stored()).length} chars`,
    });
    // A keeps working and saves (the normal thing to do in the surviving tab).
    await drawRect(page, await board(page), 0.6, 625, 325);
    await saved(page);
    await settle();
    test.info().annotations.push({
      type: 'after A saved',
      description: `stored has 624: ${(await stored()).includes('"Parça 6"') || (await stored()).length > 0}`,
    });
    // A closes normally; the next tab must apply or offer B's edit.
    await page.close();
    const c = await open(context, id);
    await saved(c);
    await settle();
    if (await c.getByTestId('parked-changes').isVisible()) {
      await c.getByTestId('parked-apply').click();
      await saved(c);
      await settle();
    }
    const s = await server(context, id);
    expect(countDim(s, 625, 325)).toBe(1);
    expect(countDim(s, 624, 324), 'B crashed edit').toBe(1);
    expect(s.revision).toBeGreaterThanOrEqual(r0 + 2);
  });

  test('row 7: taking tab has its own unsent edit → park (never merged); apply later adds once', async ({
    page,
    context,
  }) => {
    const id = await savedProject(page);
    const b = await open(context, id);
    await saved(b);
    const r0 = (await server(context, id)).revision;
    await blockPuts(b, id);
    await drawRect(b, await board(b), 0.6, 621, 321); // B: unsent
    await crashAfterEdit(page, id, 620, 320); // A: queue, base r0
    await expect(b.getByTestId('parked-changes')).toBeVisible({ timeout: 20_000 });
    await b.unroute(url(id));
    await expect.poll(async () => countDim(await server(context, id), 621, 321)).toBe(1);
    await saved(b);
    expect(countDim(await server(context, id), 620, 320)).toBe(0);
    await b.getByTestId('parked-apply').click();
    await expect.poll(async () => countDim(await server(context, id), 620, 320)).toBe(1);
    await saved(b);
    await settle();
    const s = await server(context, id);
    expect(countDim(s, 620, 320)).toBe(1);
    expect(countDim(s, 621, 321)).toBe(1);
    expect(s.revision).toBe(r0 + 2);
    await expect(b.getByTestId('parked-changes')).toHaveCount(0);
    await noParkedAfterReopen(context, id);
  });

  test('row 8: server not reachable at takeover → park; back online, apply adds once', async ({
    page,
    context,
  }) => {
    const id = await savedProject(page);
    const b = await open(context, id);
    await saved(b);
    const r0 = (await server(context, id)).revision;
    await b.route(url(id), (route) => route.abort('internetdisconnected'));
    await crashAfterEdit(page, id, 622, 322);
    await expect(b.getByTestId('parked-changes')).toBeVisible({ timeout: 20_000 });
    await b.unroute(url(id));
    await settle();
    expect(countDim(await server(context, id), 622, 322)).toBe(0);
    await b.getByTestId('parked-apply').click();
    await expect.poll(async () => countDim(await server(context, id), 622, 322)).toBe(1);
    await saved(b);
    await settle();
    const s = await server(context, id);
    expect(s.revision).toBe(r0 + 1);
    expect(s.parts).toHaveLength(6);
    await noParkedAfterReopen(context, id);
  });

  test('row 9: draft never reached the server; the copied ?taslak= opened after the crash replays it once', async ({
    page,
    context,
  }) => {
    const name = `R4draft ${Math.random().toString(36).slice(2, 8)}`;
    await openNewProject(page, 'parcalar');
    await page.route('**/api/projects', (route) =>
      route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.continue(),
    );
    await paste(page, KITCHEN, 5);
    const field = page.getByTestId('project-name');
    await field.fill(name);
    await field.press('Enter');
    await new Promise((r) => setTimeout(r, 1500));
    const draftUrl = page.url();
    expect(draftUrl).toMatch(/taslak=/);
    await crash(page);
    const b = await context.newPage();
    await b.goto(draftUrl);
    const id = await projectId(b);
    await saved(b);
    await settle();
    const s = await server(context, id);
    expect(s.parts).toHaveLength(5);
    const list = (await (await context.request.get('/api/projects')).json()) as {
      name: string;
    }[];
    const items = Array.isArray(list)
      ? list
      : ((list as { items?: { name: string }[] }).items ?? []);
    expect(items.filter((p) => p.name === name)).toHaveLength(1);
  });
});

test.describe('T326 tester r4: parked flow, many tabs, two browsers, single tab', () => {
  test.setTimeout(180_000);
  test.use({ viewport: { width: 1440, height: 900 } });

  test('crash in the middle of "Uygula" (save reached the server): next tab neither loses nor doubles', async ({
    page,
    context,
  }) => {
    const id = await savedProject(page);
    const b = await open(context, id);
    await saved(b);
    await blockPuts(b, id);
    await drawRect(b, await board(b), 0.6, 631, 331); // B unsent → A's queue gets parked
    await crashAfterEdit(page, id, 630, 330);
    await expect(b.getByTestId('parked-changes')).toBeVisible({ timeout: 20_000 });
    await b.unroute(url(id));
    await expect.poll(async () => countDim(await server(context, id), 631, 331)).toBe(1);
    await saved(b);
    // Apply: the save reaches the server, the tab dies before the answer.
    await b.route(url(id), async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      await route.fetch().catch(() => undefined);
      void crash(b);
      await route.abort('internetdisconnected').catch(() => undefined);
    });
    await b.getByTestId('parked-apply').click();
    await expect.poll(async () => countDim(await server(context, id), 630, 330)).toBe(1);
    await new Promise((r) => setTimeout(r, 1500));
    const c = await open(context, id);
    await saved(c);
    await settle();
    // Offered again? Applying it must not double the part.
    if (await c.getByTestId('parked-changes').isVisible()) {
      await c.getByTestId('parked-apply').click();
      await saved(c);
      await settle();
    }
    const s = await server(context, id);
    expect(countDim(s, 630, 330)).toBe(1);
    expect(countDim(s, 631, 331)).toBe(1);
    expect(s.parts).toHaveLength(7);
    await expect(c.getByTestId('parked-changes')).toHaveCount(0);
    await noParkedAfterReopen(context, id);
  });

  test('three tabs: A crashes with a queue, B and C both alive: the part lands exactly once', async ({
    page,
    context,
  }) => {
    const id = await savedProject(page);
    const b = await open(context, id);
    const c = await open(context, id);
    await saved(b);
    await saved(c);
    const r0 = (await server(context, id)).revision;
    await crashAfterEdit(page, id, 640, 340);
    await expect.poll(async () => countDim(await server(context, id), 640, 340)).toBe(1);
    await settle();
    // The other live tab is now stale; it edits: a conflict or a reload, never a lost part.
    await saved(b);
    await saved(c);
    const s = await server(context, id);
    expect(countDim(s, 640, 340)).toBe(1);
    expect(s.revision).toBe(r0 + 1);
    for (const p of [b, c]) await expect(p.getByTestId('parked-changes')).toHaveCount(0);
    // Close all, reopen: nothing parked, nothing applied twice.
    await b.close();
    await c.close();
    await noParkedAfterReopen(context, id);
    expect(countDim(await server(context, id), 640, 340)).toBe(1);
  });

  test('copied ?taslak= while the first tab is alive: own draft id; each tab saves only its own parts', async ({
    page,
    context,
  }) => {
    await openNewProject(page, 'parcalar');
    await page.route('**/api/projects', (route) =>
      route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.continue(),
    );
    await paste(page, 'Ad\tEn\tBoy\tAdet\nAparca\t500\t300\t1', 1);
    await new Promise((r) => setTimeout(r, 1000));
    const aUrl = page.url();
    const b = await context.newPage();
    await b.goto(aUrl);
    await expect(b.getByTestId('wizard-step-title')).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => b.url()).not.toBe(aUrl);
    await paste(b, 'Ad\tEn\tBoy\tAdet\nBparca\t400\t200\t1', 1);
    const bId = await projectId(b);
    await saved(b);
    await page.unroute('**/api/projects');
    const aId = await projectId(page);
    await saved(page);
    expect(aId).not.toBe(bId);
    expect((await server(context, aId)).parts).toEqual(['Aparca']);
    expect((await server(context, bId)).parts).toEqual(['Bparca']);
  });

  test('reload of the creating tab during its first save (reached the server): one project, parts once', async ({
    page,
    context,
  }) => {
    const name = `R4reload ${Math.random().toString(36).slice(2, 8)}`;
    await openNewProject(page, 'parcalar');
    const field = page.getByTestId('project-name');
    await field.fill(name);
    await field.press('Enter');
    let reloaded = false;
    await page.route('**/api/projects', async (route) => {
      if (route.request().method() !== 'POST' || reloaded) return route.continue();
      reloaded = true;
      await route.fetch().catch(() => undefined);
      void page.reload().catch(() => undefined);
      await route.abort('internetdisconnected').catch(() => undefined);
    });
    await paste(page, KITCHEN, 5);
    await expect.poll(() => reloaded, { timeout: 20_000 }).toBe(true);
    await page.unroute('**/api/projects');
    await wizardReady(page);
    const id = await projectId(page);
    await saved(page);
    await settle();
    expect((await server(context, id)).parts).toHaveLength(5);
    const res = await context.request.get('/api/projects');
    const body = (await res.json()) as unknown;
    const items = (Array.isArray(body) ? body : ((body as { items?: unknown[] }).items ?? [])) as {
      id: string;
      name: string;
    }[];
    expect(items.filter((p) => p.name === name).map((p) => p.id)).toEqual([id]);
  });

  test('the same project in a second browser: the stale save shows a conflict, nothing overwritten', async ({
    page,
    context,
    browser,
    baseURL,
  }) => {
    const id = await savedProject(page);
    const other = await otherBrowser(browser, baseURL);
    const o = await open(other, id);
    await saved(o);
    await drawRect(page, await board(page), 0.3, 650, 350);
    await saved(page);
    const mid = await server(context, id);
    await drawRect(o, await board(o), 0.6, 651, 351);
    await expect(o.getByTestId('conflict')).toBeVisible({ timeout: 20_000 });
    await settle();
    const s = await server(context, id);
    expect(s).toEqual(mid);
    expect(countDim(s, 650, 350)).toBe(1);
    expect(countDim(s, 651, 351)).toBe(0);
    await other.close();
  });

  test('single tab: draw, close within 1 s, reopen: the part is there once; prompt only while unsaved', async ({
    page,
    context,
  }) => {
    const id = await savedProject(page);
    const r0 = (await server(context, id)).revision;
    // No prompt after a completed save.
    let dialogs = 0;
    page.on('dialog', (d) => {
      dialogs++;
      void d.accept();
    });
    await drawRect(page, await board(page), 0.3, 660, 360);
    await page.close({ runBeforeUnload: true });
    await expect.poll(() => dialogs).toBe(1); // unsaved: the browser asks
    await new Promise((r) => setTimeout(r, 1500));
    const p = await open(context, id);
    await saved(p);
    await settle();
    const s = await server(context, id);
    expect(countDim(s, 660, 360)).toBe(1);
    expect(s.parts).toHaveLength(6);
    expect(s.revision).toBe(r0 + 1);
    await expect(p.getByTestId('parked-changes')).toHaveCount(0);
    let asked = 0;
    p.on('dialog', (d) => {
      asked++;
      void d.accept();
    });
    await p.close({ runBeforeUnload: true });
    expect(asked).toBe(0); // saved: no prompt
  });
});
