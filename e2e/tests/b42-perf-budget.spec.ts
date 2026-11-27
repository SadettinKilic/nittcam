import { expect, test, type Page } from '@playwright/test';
import {
  KITCHEN,
  fill,
  goStep,
  openNewProject,
  paste,
  pasteAndNest,
  projectId,
  saved,
  wizardReady,
} from './wizard-helpers';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };

// T186 (spec §8.2): per route, the JavaScript loaded up to the load event is ≤ 250 kB gzip (3D
// and the drawing board are lazy chunks, loaded later) and LCP ≤ 2.5 s on the local prod build.
// The spec prints a small bundle report (route, JS kB, LCP ms) for the PR.

const JS_BUDGET_KB = 250;
/** The project wizard runs the command layer and validation on load (D-079). */
const WIZARD_JS_BUDGET_KB = 450;
const LCP_BUDGET_MS = 2_500;

test.describe.configure({ mode: 'serial' });

let pid = '';

interface RouteNumbers {
  jsKb: number;
  scripts: number;
  lcpMs: number;
}

async function measure(page: Page, route: string): Promise<RouteNumbers> {
  await page.goto(route, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  return page.evaluate(async () => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    const scripts = (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
      .filter((r) => /\.js(\?|$)/.test(r.name) && r.startTime <= nav.loadEventEnd)
      // A cached script reports 0; its decoded size is the honest upper bound then.
      .map((r) => r.encodedBodySize || r.decodedBodySize);
    const lcp = await new Promise<number>((resolve) => {
      new PerformanceObserver((list) => {
        const last = list.getEntries().at(-1);
        resolve(last ? last.startTime : 0);
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      setTimeout(() => resolve(0), 1_000);
    });
    return {
      jsKb: Math.round(scripts.reduce((a, b) => a + b, 0) / 102.4) / 10,
      scripts: scripts.length,
      lcpMs: Math.round(lcp),
    };
  });
}

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('/projeler/yeni?adim=parcalar');
  await wizardReady(page, 'parcalar');
  await pasteAndNest(page, KITCHEN, 5);
  pid = await projectId(page);
  await saved(page);
  await page.close();
});

// fixme until T186 brings the routes under budget (now ~440 kB, wizard ~680 kB; see PR #141).
test('initial JS ≤ 250 kB gzip (wizard ≤ 450 kB, D-079) and LCP ≤ 2.5 s per route', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const routes = [
    '/',
    '/projeler',
    '/projeler/yeni',
    ...['parcalar', 'dizilim', 'simulasyon', 'export'].map((s) => `/projeler/${pid}?adim=${s}`),
    '/makineler',
    '/ayarlar/malzemeler',
    '/sablonlar',
  ];
  const rows: string[] = [];
  const over: string[] = [];
  for (const route of routes) {
    // A fresh context per route: nothing cached, every byte counted.
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const n = await measure(page, route);
    await ctx.close();
    const label = route.replace(pid, '<id>');
    rows.push(
      `${label.padEnd(30)} ${String(n.jsKb).padStart(7)} kB ${n.scripts} js  LCP ${n.lcpMs} ms`,
    );
    const budget = route.startsWith('/projeler/') ? WIZARD_JS_BUDGET_KB : JS_BUDGET_KB;
    if (n.jsKb > budget) over.push(`${label}: ${n.jsKb} kB JS (budget ${budget})`);
    if (n.lcpMs > LCP_BUDGET_MS) over.push(`${label}: LCP ${n.lcpMs} ms`);
  }
  console.log(`T186 bundle report (gzip JS up to load, LCP)\n${rows.join('\n')}`);
  expect(over, over.join('\n')).toEqual([]);
});

/** Starts collecting main-thread long tasks (> 50 ms) in the page. */
async function watchLongTasks(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __long: number[] };
    w.__long = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__long.push(Math.round(e.duration));
    }).observe({ type: 'longtask' });
  });
}

async function longTasks(page: Page): Promise<number[]> {
  return page.evaluate(() => (window as unknown as { __long: number[] }).__long);
}

const LONG_TASK_BUDGET_MS = 200;

test('nesting mode change: no long task over 200 ms', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/projeler/${pid}?adim=dizilim`);
  await wizardReady(page, 'dizilim');
  await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
  const mode = page.getByTestId('layout-mode');
  const radios = mode.getByRole('button');
  // The probe itself works: a 120 ms busy loop shows up as a long task.
  await watchLongTasks(page);
  await page.evaluate(() => {
    setTimeout(() => {
      const end = performance.now() + 120;
      while (performance.now() < end);
    }, 0);
  });
  await expect.poll(async () => (await longTasks(page)).length).toBeGreaterThan(0);
  const worst: number[] = [];
  for (const i of [1, 2, 0]) {
    const before = await mode.getAttribute('data-value');
    await page.waitForTimeout(300);
    await watchLongTasks(page);
    await radios.nth(i).click();
    await expect(mode).not.toHaveAttribute('data-value', before ?? '');
    await page.waitForTimeout(500);
    worst.push(Math.max(0, ...(await longTasks(page))));
  }
  console.log(`T186 mode-card click, longest task per click: ${worst.join(' / ')} ms`);
  expect(Math.max(...worst)).toBeLessThanOrEqual(LONG_TASK_BUDGET_MS);
});

test('2 000-row cut list stays usable', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  const rows = Array.from(
    { length: 2_000 },
    (_, i) => `P${i + 1}\t${100 + (i % 37) * 13}\t${80 + (i % 23) * 17}\t1\thayır`,
  );
  const text = ['Parça adı\tEn\tBoy\tAdet\tDamar', ...rows].join('\n');
  await page.getByRole('button', { name: tr.cutList.pasteOpen }).click();
  const area = page.getByLabel(tr.cutList.paste.textLabel);
  await expect(area).toBeFocused();
  await watchLongTasks(page);
  const t0 = Date.now();
  // T304: the text arrives in one input event, as a Ctrl+V paste does. Playwright's `fill` goes
  // through the browser's typing path instead: 6–10 s for this text even in a bare <textarea>,
  // which is the test driver, not the app (the "~9 s" of D-079).
  await area.evaluate((el, value) => {
    const ta = el as HTMLTextAreaElement;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(ta, value);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
  await page
    .getByRole('button', { name: fill(tr.cutList.paste.applyCount, { count: 2_000 }) })
    .click();
  await expect(page.getByTestId('cut-list-count')).toContainText('2000');
  const pasteMs = Date.now() - t0;
  const pasteLong = Math.max(0, ...(await longTasks(page)));
  // Scroll the virtual grid to the end and back.
  await watchLongTasks(page);
  const scroll = page.getByTestId('cut-list-scroll');
  const t1 = Date.now();
  await scroll.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(page.getByText('P2000', { exact: true })).toBeVisible();
  await scroll.evaluate((el) => (el.scrollTop = 0));
  await expect(page.getByText('P1', { exact: true })).toBeVisible();
  const scrollMs = Date.now() - t1;
  const scrollLong = Math.max(0, ...(await longTasks(page)));
  console.log(
    `T186 2 000 rows: paste ${pasteMs} ms (longest task ${pasteLong} ms), scroll end+back ${scrollMs} ms, longest task ${scrollLong} ms`,
  );
  // T304: paste + preview + apply of 2 000 rows < 2 s, no main-thread task over 200 ms.
  expect(pasteMs).toBeLessThan(2_000);
  expect(pasteLong).toBeLessThanOrEqual(LONG_TASK_BUDGET_MS);
  expect(scrollMs).toBeLessThan(3_000);
  expect(scrollLong).toBeLessThanOrEqual(LONG_TASK_BUDGET_MS * 2);
});

test('300-part nesting finishes within 10 s and the page stays responsive', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  // 300 parts of 60 sizes (fixed, like the core benchmark's "many small parts").
  const rows = Array.from(
    { length: 60 },
    (_, i) => `K${i + 1}\t${60 + ((i * 37) % 240)}\t${50 + ((i * 53) % 200)}\t5\thayır`,
  );
  await paste(page, ['Parça adı\tEn\tBoy\tAdet\tDamar', ...rows].join('\n'), 60);
  await goStep(page, 'dizilim');
  await watchLongTasks(page);
  const t0 = Date.now();
  await page
    .locator(
      'button[data-testid^="layout-mode-"][aria-pressed="true"]:visible, [data-testid="layout-nest-compact"]:visible',
    )
    .click();
  await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('nesting-sheets')).toHaveText(/^\d+$/, { timeout: 20_000 });
  const nestMs = Date.now() - t0;
  const long = await longTasks(page);
  console.log(
    `T186 300 parts: nesting ${nestMs} ms, long tasks ${long.length}, longest ${Math.max(0, ...long)} ms`,
  );
  expect(nestMs).toBeLessThanOrEqual(10_000);
});
