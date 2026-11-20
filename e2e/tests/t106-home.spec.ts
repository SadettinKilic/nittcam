import { expect, test, type APIRequestContext } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { THEMES, VIEWPORTS, applyTheme, expectNoA11yViolations, snap } from './visual/helpers';

// T106: the redesigned home page with data (the chromium run shares its database with other
// tests, so these are review captures + axe, not baselines; the empty state has baselines).
const t = tr.home;

function rect(id: string, name: string, w: number, h: number, qty: number) {
  return {
    id,
    name,
    qty,
    grainLock: false,
    inners: [],
    holes: [],
    edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
    templates: [],
    kind: 'rect',
    params: { w, h, r: 0 },
  };
}

async function createProject(request: APIRequestContext, name: string, withLayout: boolean) {
  const machines = (await (await request.get('/api/machines')).json()) as {
    id: string;
    version: number;
  }[];
  const m = machines[0];
  if (!m) throw new Error('no machine seeded');
  const placements = withLayout
    ? [
        { partId: 'c', index: 0, x: 10, y: 10, rot: 0, locked: false },
        { partId: 'a', index: 0, x: 1220, y: 10, rot: 0, locked: false },
        { partId: 'a', index: 1, x: 1950, y: 10, rot: 0, locked: false },
        { partId: 'b', index: 0, x: 10, y: 720, rot: 90, locked: false },
      ]
    : [];
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
        parts: [
          rect('a', 'Yan dikme', 720, 560, 2),
          rect('b', 'Raf', 680, 540, 1),
          rect('c', 'Arkalık', 1200, 700, 1),
        ],
        nesting: { mode: 'minWaste', gap: 8, margin: 10 },
        layout: { sheets: withLayout ? [{ placements }] : [] },
        cutting: { tabs: { auto: true }, leadIn: 'arc', direction: 'climb' },
        settings: { dimensionMode: 'cut' },
      },
    },
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string };
}

test.describe('T106 home dashboard', () => {
  test('filled: KPI tiles, project cards with thumbnail, machines, quick actions', async ({
    page,
  }) => {
    const stamp = Date.now();
    const drawn = `T106 dolap ${stamp}`;
    const bare = `T106 masa ${stamp}`;
    await createProject(page.request, bare, false);
    const created = await createProject(page.request, drawn, true);

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t.title);
    const projects = page.getByTestId('home-projects').filter({ visible: true });
    await expect(projects).toContainText(drawn);
    // Our newest project shows its layout thumbnail (other tests may add projects in parallel).
    const first = projects.getByRole('listitem').filter({ hasText: drawn });
    await expect(first.getByRole('img', { name: drawn })).toBeVisible();
    // T180: sheet well + material tint + 4 parts (one sheet, so no stack behind it).
    await expect(first.locator('svg rect')).toHaveCount(6);
    await expect(first.locator('svg[data-stack]')).toHaveAttribute('data-stack', '0');
    await expect(first).toContainText(t.card.noExport);
    await expect(projects.getByRole('listitem').filter({ hasText: bare })).toContainText(
      t.card.noLayout,
    );

    // KPI tiles: numbers are integers; machines tile reads "verified / total".
    expect(
      Number(await page.getByTestId('stat-projects').locator('p').first().innerText()),
    ).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId('stat-machines')).toContainText(/\d+ \/ \d+/);
    // T180: with a layout in the last 30 days the waste KPI is the fourth tile.
    await expect(page.getByTestId('stat-waste')).toContainText('%');
    await expect(page.getByTestId('home-start')).toHaveCount(0);

    // Section header links stay on the heading's line (no wrap under the title).
    for (const [heading, link] of [
      [t.recent, t.allProjects],
      [t.machines, t.allMachines],
    ] as const) {
      const h = await page.getByRole('heading', { name: heading, exact: true }).boundingBox();
      const l = await page.getByRole('link', { name: link }).boundingBox();
      expect(Math.abs((h?.y ?? 0) - (l?.y ?? 999))).toBeLessThan(8);
    }

    // The card opens the project.
    await first.getByRole('link', { name: drawn }).click();
    await expect(page).toHaveURL(new RegExp(`/projeler/${created.id}`));
  });

  test('T180 waste summary: the project bar shows the report value', async ({ page }) => {
    const name = `T180 fire ${Date.now()}`;
    const { id } = await createProject(page.request, name, true);
    const project = (await (await page.request.get(`/api/projects/${id}`)).json()) as {
      revision: number;
      project: { parts: unknown[]; layout: { sheets: unknown[] } };
    };
    const report = (await (
      await page.request.get(`/api/projects/${id}/report?revision=${project.revision}`)
    ).json()) as { wastePercent: number };
    const pct = new Intl.NumberFormat('tr-TR', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(report.wastePercent);
    await page.goto('/');
    const card = page.getByTestId('home-waste');
    await expect(card).toBeVisible();
    const bar = card.getByTestId('home-waste-bar').filter({ hasText: name });
    await expect(bar).toContainText(`%${pct}`);
    await expect(page.getByTestId('home-waste-avg')).toContainText('%');
    // An untouched empty draft does not take a "Son projeler" card (P4).
    const empty = await page.request.post('/api/projects', {
      data: {
        name: `T180 boş ${Date.now()}`,
        project: { ...project.project, parts: [], layout: { sheets: [] } },
      },
    });
    expect(empty.ok()).toBeTruthy();
    const emptyId = ((await empty.json()) as { id: string }).id;
    await page.reload();
    await expect(
      page
        .getByTestId('home-projects')
        .filter({ visible: true })
        .locator(`a[href="/projeler/${emptyId}"]`),
    ).toHaveCount(0);
  });

  test('quick actions and machine CTA go to the right pages', async ({ page }) => {
    await page.goto('/');
    const quick = page.getByTestId('home-quick');
    await expect(
      quick.getByRole('link', { name: new RegExp(t.quick.paste.title) }),
    ).toHaveAttribute('href', '/projeler/yeni?adim=parcalar');
    await quick.getByRole('link', { name: new RegExp(t.quick.addMachine.title) }).click();
    await expect(page.getByRole('heading', { name: tr.machines.form.createTitle })).toBeVisible();

    await page.goto('/');
    const verify = page.getByTestId('home-machines').getByRole('link', { name: /^Doğrula: / });
    await verify.first().click();
    await expect(page).toHaveURL(/\/makineler\/[0-9a-f-]+\/dogrulama$/);
  });

  for (const [vp, size] of Object.entries(VIEWPORTS)) {
    for (const theme of THEMES) {
      test(`axe + review capture ${vp} ${theme}`, async ({ page }) => {
        await page.setViewportSize(size);
        await applyTheme(page, theme);
        await createProject(page.request, `T106 görsel ${Date.now()}`, true);
        await page.goto('/');
        await expect(page.getByTestId('home-projects').filter({ visible: true })).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
        await expectNoA11yViolations(page);
        await snap(page, `t106-home-${vp}-${theme}`, { baseline: false });
      });
    }
  }
});
