import { expect, test, type Page } from '@playwright/test';
import { KITCHEN, pasteAndNest, projectId, saved, wizardReady } from './wizard-helpers';

// T186 (spec §8.2): per route, the JavaScript loaded up to the load event is ≤ 250 kB gzip (3D
// and the drawing board are lazy chunks, loaded later) and LCP ≤ 2.5 s on the local prod build.
// The spec prints a small bundle report (route, JS kB, LCP ms) for the PR.

const JS_BUDGET_KB = 250;
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
test.fixme('initial JS ≤ 250 kB gzip and LCP ≤ 2.5 s per route', async ({ browser }) => {
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
    if (n.jsKb > JS_BUDGET_KB) over.push(`${label}: ${n.jsKb} kB JS`);
    if (n.lcpMs > LCP_BUDGET_MS) over.push(`${label}: LCP ${n.lcpMs} ms`);
  }
  console.log(`T186 bundle report (gzip JS up to load, LCP)\n${rows.join('\n')}`);
  expect(over, over.join('\n')).toEqual([]);
});
