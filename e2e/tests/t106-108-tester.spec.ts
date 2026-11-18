import { expect, test, type APIRequestContext } from '@playwright/test';
import { THEMES, applyTheme } from './visual/helpers';

// B3 tester probes: shell sidebar must stay full height when a page scrolls (PO finding),
// KPI tiles follow the database.
async function seedProject(request: APIRequestContext, name: string) {
  const machines = (await (await request.get('/api/machines')).json()) as {
    id: string;
    version: number;
  }[];
  const m = machines[0];
  if (!m) throw new Error('no machine');
  const part = {
    id: 'a',
    name: 'P',
    qty: 1,
    grainLock: false,
    inners: [],
    holes: [],
    edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
    templates: [],
    kind: 'rect',
    params: { w: 700, h: 500, r: 0 },
  };
  const res = await request.post('/api/projects', {
    data: {
      name,
      project: {
        schemaVersion: 1,
        machine: { machineId: m.id, profileVersion: m.version },
        stock: {
          material: 'mdf',
          thickness: 18,
          sheet: { width: 2800, height: 2070, grain: 0 },
          useOffcuts: false,
        },
        parts: [part],
        nesting: { mode: 'minWaste', gap: 8, margin: 10 },
        layout: {
          sheets: [
            { placements: [{ partId: 'a', index: 0, x: 10, y: 10, rot: 0, locked: false }] },
          ],
        },
        cutting: { tabs: { auto: true }, leadIn: 'arc', direction: 'climb' },
        settings: { dimensionMode: 'cut' },
      },
    },
  });
  expect(res.status()).toBe(201);
}

test.describe('B3 sidebar spans the full height when the page scrolls', () => {
  for (const theme of THEMES) {
    for (const path of ['/', '/makineler', '/projeler']) {
      test(`${path} ${theme}`, async ({ page, request }) => {
        for (let i = 0; i < 4; i++) await seedProject(request, `Kaydırma ${i}`);
        await page.setViewportSize({ width: 1440, height: 900 });
        await applyTheme(page, theme);
        await page.goto(path);
        await page.getByTestId('shell-sidebar').waitFor();
        const scrollable = await page.evaluate(
          () => document.documentElement.scrollHeight - window.innerHeight,
        );
        test.info().annotations.push({ type: 'scrollable', description: String(scrollable) });
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(200);
        const probe = await page.evaluate(() => {
          const sb = document
            .querySelector('[data-testid="shell-sidebar"]')
            ?.getBoundingClientRect() ?? { top: 1, bottom: 0 };
          // pixel just below the sidebar's first viewport: what element is at the sidebar's x, bottom of viewport
          const el = document.elementFromPoint(40, window.innerHeight - 4);
          return {
            top: sb.top,
            bottom: sb.bottom,
            vh: window.innerHeight,
            inSidebar: !!el?.closest('[data-testid="shell-sidebar"]'),
          };
        });
        expect(probe.top).toBeLessThanOrEqual(0.5);
        expect(probe.bottom).toBeGreaterThanOrEqual(probe.vh - 1);
        expect(probe.inSidebar).toBe(true);
        await page.screenshot({
          path: `__screenshots__/b3-scrolled-${path === '/' ? 'home' : path.slice(1)}-${theme}.png`,
        });
      });
    }
  }
});

import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
const mt = tr.machines;
const mf = mt.form.fields;

test.describe('B3 machine form leave guard and save', () => {
  test('beforeunload fires when dirty; saving clears the guard (no dialog, no beforeunload)', async ({
    page,
  }) => {
    await page.goto('/makineler');
    await page.getByRole('button', { name: mt.add }).click();
    await page.getByLabel(mf.name).fill(`Guard ${Date.now()}`);
    const probe = () =>
      page.evaluate(() => {
        const ev = new Event('beforeunload', { cancelable: true });
        window.dispatchEvent(ev);
        return ev.defaultPrevented;
      });
    expect(await probe()).toBe(true);
    await page.getByRole('button', { name: mt.form.save }).click();
    await expect(page.getByTestId('machine-list')).toBeVisible();
    // back on the list: nothing guards any more
    expect(await probe()).toBe(false);
    await page.getByTestId('shell-sidebar').getByRole('link', { name: tr.nav.projects }).click();
    await expect(page).toHaveURL(/\/projeler$/);
    await expect(page.getByTestId('machine-leave-dialog')).toHaveCount(0);
  });

  // Fixed in B4 (PO follow-up): browser Back and the palette are guarded too.
  test('dirty form: browser Back asks before discarding', async ({ page }) => {
    await page.goto('/projeler');
    await page.goto('/makineler');
    await page.getByRole('button', { name: mt.add }).click();
    await page.getByLabel(mf.name).fill('Kaybolmasin');
    await page.goBack();
    await expect(page.getByTestId('machine-leave-dialog')).toBeVisible({ timeout: 2000 });
  });

  test('dirty form: command palette navigation asks before discarding', async ({ page }) => {
    await page.goto('/makineler');
    await page.getByRole('button', { name: mt.add }).click();
    await page.getByLabel(mf.name).fill('Kaybolmasin');
    await page.keyboard.press('Control+k');
    await page.getByRole('dialog').getByText(tr.nav.projects, { exact: true }).first().click();
    await expect(page.getByTestId('machine-leave-dialog')).toBeVisible({ timeout: 2000 });
  });
});

test('B3 KPI tiles follow the database (projects, exports this week)', async ({
  page,
  request,
}) => {
  const read = async () => {
    await page.goto('/');
    const p = await page.getByTestId('stat-projects').innerText();
    const e = await page.getByTestId('stat-exports').innerText();
    return {
      p: parseInt(p.split('\n').find((l) => /^\d/.test(l)) ?? '-1', 10),
      e: parseInt(e.split('\n').find((l) => /^\d/.test(l)) ?? '-1', 10),
    };
  };
  const apiCount = async () =>
    ((await (await request.get('/api/projects')).json()) as unknown[]).length;
  const before = await read();
  // shared DB: parallel workers add projects/exports, so only monotonic deltas are asserted
  expect(before.p).toBeGreaterThan(0);
  expect(Math.abs(before.p - (await apiCount()))).toBeLessThan(50);
  await seedProject(request, 'KPI proje');
  const mid = await read();
  expect(mid.p).toBeGreaterThanOrEqual(before.p + 1);
  const list = (await (await request.get('/api/projects')).json()) as {
    id: string;
    name: string;
  }[];
  const id = list.find((x) => x.name === 'KPI proje')?.id;
  expect(id).toBeTruthy();
  const detail = (await (await request.get(`/api/projects/${id}`)).json()) as { revision: number };
  const res = await request.post(`/api/projects/${id}/export`, {
    data: { revision: detail.revision, acceptUnverified: true },
  });
  test.info().annotations.push({ type: 'export-status', description: String(res.status()) });
  expect(res.status()).toBe(201);
  const after = await read();
  expect(after.e).toBeGreaterThanOrEqual(mid.e + 1);
});
