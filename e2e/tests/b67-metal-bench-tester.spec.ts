import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  goStep,
  KITCHEN_3,
  nest,
  openNewProject,
  paste,
  projectId,
  saved,
  wizardReady,
} from './wizard-helpers';

// B67 tester: wood panel + aluminium bracket with aligned holes → fastener marker row; the
// material override leaves the NC export untouched; 1440 / 390 looks and axe on the bench.
test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] } });

const SHOTS = process.env.B67_SHOTS;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};
const PARTS = ['Parça adı\tEn\tBoy\tAdet', 'Panel\t300\t200\t1', 'Braket\t60\t40\t1'].join('\n');
const FLAT_Q = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];

type Proj = {
  stock: { thickness: number };
  parts: { id: string; name: string; holes: unknown[] }[];
  assembly?: unknown;
};

async function get(page: Page, id: string) {
  return (await (await page.request.get(`/api/projects/${id}`)).json()) as {
    revision: number;
    project: Proj;
  };
}
async function put(page: Page, id: string, cur: { revision: number; project: Proj }) {
  const r = await page.request.put(`/api/projects/${id}`, {
    data: { project: cur.project, baseRevision: cur.revision, commands: [] },
  });
  expect(r.status(), await r.text()).toBe(200);
}
/** The stored NC text of the current revision, revision numbers blanked (they differ by design). */
async function ncText(page: Page, id: string) {
  const cur = await get(page, id);
  const r = await page.request.post(`/api/projects/${id}/export`, {
    data: { revision: cur.revision, acceptUnverified: true, checklistConfirmed: true },
  });
  expect([200, 201], await r.text()).toContain(r.status());
  const rec = (await r.json()) as { files: { downloadUrl: string }[] };
  expect(rec.files.length).toBeGreaterThan(0);
  const out: string[] = [];
  for (const file of rec.files) {
    const c = await page.request.get(file.downloadUrl);
    out.push((await c.text()).replace(/REVIZYON: [0-9]+/g, 'REVIZYON: N'));
  }
  return out;
}

test('aluminium bracket over aligned holes: fastener row, NC unchanged by the override', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await paste(page, PARTS, 2);
  await saved(page);
  const id = await projectId(page);
  const cur = await get(page, id);
  const t = cur.project.stock.thickness;
  const pn = cur.project.parts.find((p) => p.name === 'Panel');
  const br = cur.project.parts.find((p) => p.name === 'Braket');
  if (!pn || !br) throw new Error('parts');
  pn.holes = [{ id: 'h1', type: 'through', tool: 1, d: 10, cx: 50, cy: 50 }];
  br.holes = [{ id: 'h2', type: 'through', tool: 1, d: 10, cx: 30, cy: 20 }];
  cur.project.assembly = {
    instances: [
      {
        id: `${pn.id}#0`,
        partId: pn.id,
        copy: 0,
        position: [150, t / 2, 0],
        rotation: FLAT_Q,
        hidden: false,
      },
      {
        id: `${br.id}#0`,
        partId: br.id,
        copy: 0,
        position: [50, t + 1.5, 50],
        rotation: FLAT_Q,
        hidden: false,
      },
    ],
    updatedAt: '2026-11-28T10:00:00Z',
  };
  await put(page, id, cur);
  await page.goto(`/projeler/${id}?adim=parcalar`);
  await wizardReady(page, 'parcalar');
  await nest(page);
  await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 30_000 });
  await saved(page);
  const before = await ncText(page, id);
  expect(before.join().length).toBeGreaterThan(100);

  await page.goto(`/projeler/${id}?adim=parcalar`);
  await wizardReady(page, 'parcalar');
  await page.getByTestId('parts-view-assembly').click();
  await expect(page.getByTestId('bench')).toHaveAttribute('data-ready', 'true', {
    timeout: 30_000,
  });
  await page
    .getByTestId('bench-part')
    .nth(1)
    .getByRole('button', { pressed: false })
    .first()
    .click();
  await page.getByTestId('bench-material').click();
  await page.getByRole('option', { name: tr.materials.aluminium }).click();
  await expect(page.getByTestId('bench-thickness')).toBeVisible();
  await page.getByTestId('bench-thickness').fill('3');
  await page.getByTestId('bench-thickness').press('Enter');
  await saved(page);
  await expect(page.getByTestId('bench-fastener-rows')).toContainText('Vida');
  await expect(page.getByTestId('bench-fastener-rows')).toContainText('1 ×');
  await shot(page, 'bench-fastener-1440');
  await page.getByTestId('bench-fasteners').uncheck();
  await page.getByTestId('bench-fasteners').check();

  const after = await ncText(page, id);
  expect(after).toEqual(before);
  const pdf = await page.request.get(`/api/projects/${id}/pdf?paper=a4`);
  expect([200, 400, 404]).toContain(pdf.status());
});

for (const [w, h] of [
  [1440, 900],
  [390, 844],
] as const) {
  test(`bench ${w}: no page scroll, axe clean`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: w, height: h });
    await openNewProject(page, 'parcalar');
    await paste(page, PARTS, 2);
    await page.getByTestId('parts-view-assembly').click();
    await expect(page.getByTestId('bench')).toHaveAttribute('data-ready', 'true', {
      timeout: 30_000,
    });
    await page.waitForTimeout(800);
    await shot(page, `bench-${w}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    const res = await new AxeBuilder({ page }).analyze();
    const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
  });
}

for (const [w, h] of [
  [1024, 768],
  [390, 844],
] as const) {
  test(`Dizilim ${w}, 3 sheets: tabs reachable, no page scroll, axe clean`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: w, height: h });
    await openNewProject(page, 'parcalar');
    await paste(page, KITCHEN_3, 5);
    await goStep(page, 'dizilim');
    const tabs = page.getByTestId('sheet-tabs-scroll').getByRole('tab');
    await expect(tabs).toHaveCount(4, { timeout: 30_000 });
    // Keyboard: focusing the last tab and activating it works even when it was clipped.
    await tabs.last().focus();
    await page.keyboard.press('Enter');
    await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(
      true,
    );
    const res = await new AxeBuilder({ page }).analyze();
    const bad = res.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(bad.map((v) => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([]);
  });
}
