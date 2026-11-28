import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  chooseMachine,
  goStep,
  openCutListAction,
  openNewProject,
  openWorkspacePanel,
  pickOption,
  watchConsole,
} from './wizard-helpers';

// B70 tester: T391 tray with corner reliefs folds closed; no relief is red; per-groove slider;
// over-fold warning; display only (reload = flat); DXF layer-name suggestion; 390 smoke + axe.
test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] } });

const f = tr.bench.fold;
const g = (c: number, v: string | number) => `${String(c).padStart(3)}\n${v}`;
const line = (layer: string, x1: number, y1: number, x2: number, y2: number) => [
  g(0, 'LINE'),
  g(8, layer),
  g(10, x1),
  g(20, y1),
  g(11, x2),
  g(21, y2),
];
type Pt = [number, number];
// Side flanges are recessed by the 4 mm thickness at both ends, so the folded flanges just meet.
// (Plain 25 x 25 corner squares left a 3.5 mm overlap at every corner: the fold check was right.)
const RELIEF: Pt[] = [
  [25, 0],
  [175, 0],
  [175, 25],
  [175, 29],
  [200, 29],
  [200, 171],
  [175, 171],
  [175, 175],
  [175, 200],
  [25, 200],
  [25, 175],
  [25, 171],
  [0, 171],
  [0, 29],
  [25, 29],
  [25, 25],
];
const SQUARE: Pt[] = [
  [0, 0],
  [200, 0],
  [200, 200],
  [0, 200],
];
/** 200 x 200 tray: 150 base + four 25 flanges; relief = corner squares cut out. */
function trayDxf(layer: string, relief: boolean): string {
  const pts = relief ? RELIEF : SQUARE;
  return [
    g(0, 'SECTION'),
    g(2, 'HEADER'),
    g(9, '$INSUNITS'),
    g(70, 4),
    g(0, 'ENDSEC'),
    g(0, 'SECTION'),
    g(2, 'ENTITIES'),
    g(0, 'LWPOLYLINE'),
    g(8, 'PART'),
    g(90, pts.length),
    g(70, 1),
    ...pts.flatMap(([x, y]) => [g(10, x), g(20, y)]),
    // Fold lines end on the outline. With corner reliefs they meet at the corners and chain into
    // one closed contour (round 1 blocker; each edge is a hinge now).
    ...(relief
      ? [
          ...line(layer, 25, 25, 25, 175),
          ...line(layer, 25, 175, 175, 175),
          ...line(layer, 175, 175, 175, 25),
          ...line(layer, 175, 25, 25, 25),
        ]
      : [
          ...line(layer, 25, 0, 25, 200),
          ...line(layer, 175, 0, 175, 200),
          ...line(layer, 0, 25, 200, 25),
          ...line(layer, 0, 175, 200, 175),
        ]),
    g(0, 'ENDSEC'),
    g(0, 'EOF'),
  ].join('\n');
}

async function importDxf(page: Page, name: string, text: string) {
  await openCutListAction(page, 'dxf-open');
  const dialog = page.getByTestId('dxf-dialog');
  await dialog
    .getByTestId('dxf-file')
    .setInputFiles({ name, mimeType: 'application/dxf', buffer: Buffer.from(text) });
  return dialog;
}

async function acmProject(page: Page, text: string, layer = 'V-kanal') {
  // Own machine (a copy of the seeded one): the example ACM sets must not touch the shared seed.
  const list = (await (await page.request.get('/api/machines')).json()) as { id: string }[];
  const seed = (await (await page.request.get(`/api/machines/${list[0]?.id}`)).json()) as {
    profile: { identity: Record<string, unknown>; tools: { type: string }[] };
  };
  const name = `B70 ACM ${Date.now()}`;
  const profile = structuredClone(seed.profile);
  profile.identity = { ...profile.identity, name };
  // no V-bit: the example button adds one (B70 rider)
  profile.tools = profile.tools.filter((t) => t.type !== 'vBit');
  const made = await page.request.post('/api/machines', { data: { profile } });
  expect(made.status(), await made.text()).toBeLessThan(300);
  await openNewProject(page, 'makine');
  await chooseMachine(page, name);
  await pickOption(page.getByTestId('wizard-material'), tr.materials.acm);
  const add = page.getByTestId('add-acm-examples');
  await expect(add).toBeVisible({ timeout: 15_000 });
  await add.click();
  await expect(page.getByTestId('machine-form')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('machine-dirty')).toBeVisible();
  // ACM has no presets: the example rows come empty; fill the four numbers of each.
  const vals: Record<string, string> = {
    'Besleme (mm/dk)': '3000',
    'Dalma hızı (mm/dk)': '800',
    'Devir (dev/dk)': '18000',
    'Paso derinliği (mm)': '1',
  };
  for (const [label, v] of Object.entries(vals)) {
    const boxes = page.getByRole('spinbutton', { name: label });
    const n = await boxes.count();
    for (const i of [n - 2, n - 1]) {
      await boxes.nth(i).fill(v);
      await boxes.nth(i).press('Tab');
    }
  }
  await page.getByRole('button', { name: tr.machines.form.save, exact: true }).click();
  await expect(page.getByText(/Kaydedildi: sürüm/)).toBeVisible({ timeout: 30_000 });
  await openNewProject(page, 'makine');
  await chooseMachine(page, name);
  await pickOption(page.getByTestId('wizard-material'), tr.materials.acm);
  await expect(add).toBeHidden();
  await expect(page.getByTestId('wizard-material')).toContainText(tr.materials.acm);
  await goStep(page, 'parcalar');
  const dialog = await importDxf(page, 'tepsi.dxf', text);
  await expect(dialog.getByTestId(`dxf-layer-${layer}`)).toHaveAttribute('data-value', 'vgroove');
  await dialog.getByTestId('dxf-confirm').click();
  await expect(dialog).toBeHidden();
}

async function openBench(page: Page) {
  await page.getByTestId('parts-view-assembly').click();
  const bench = page.getByTestId('bench');
  await expect(bench).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  return bench;
}

async function foldAll(page: Page) {
  await page.getByTestId('bench-fold-all').getByRole('slider').focus();
  await page.keyboard.press('End');
}

const issues = (panel: Locator) => panel.getByTestId('bench-fold-issues');

test('ACM tray with corner reliefs closes; groove sliders; crush warning; reload is flat', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors = watchConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await acmProject(page, trayDxf('V-kanal', true));
  const bench = await openBench(page);
  const panel = page.getByTestId('bench-fold');
  await expect(panel).toBeVisible();
  await expect(bench).toHaveAttribute('data-fold', '0');
  await expect(panel.getByTestId('bench-fold-groove-4')).toBeVisible();
  await expect(panel.getByTestId('bench-fold-groove-5')).toHaveCount(0);
  // the seeded example V-bit gives the groove a tool: no "no V-bit" note
  await expect(panel).not.toContainText(f.noTool);

  await foldAll(page);
  await expect(bench).toHaveAttribute('data-fold', '100');
  await expect(panel.getByTestId('bench-fold-part')).not.toHaveAttribute('data-state', 'clash');
  await expect(panel.getByTestId('bench-fold-state')).toHaveText(
    new RegExp(`${f.states.closed}|${f.states.gap}`),
  );
  const txt =
    (await issues(panel)
      .textContent({ timeout: 1000 })
      .catch(() => '')) ?? '';
  expect(txt).not.toContain('boşaltması gerekli');
  expect(txt).not.toMatch(/çakışıyor/);
  // listed corner gaps stay within 1 mm
  for (const m of txt.matchAll(/boşluğu ([\d.,]+) mm/g))
    expect(Number(m[1]?.replace(',', '.'))).toBeLessThanOrEqual(1);
  // fit check runs on the folded shape without crashing
  await page.getByTestId('bench-check-toggle').click();
  await expect(bench).toHaveAttribute('data-check', 'done', { timeout: 30_000 });
  await page.getByTestId('bench-check-toggle').click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'e2e/__screenshots__/b70-tester-folded-1440.png' });
  await page.getByTestId('bench-view-front').click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'e2e/__screenshots__/b70-tester-folded-front-1440.png' });

  // per-groove slider: groove 1 back to flat while the rest stay folded
  await panel.getByTestId('bench-fold-groove-1').getByRole('slider').focus();
  await page.keyboard.press('Home');
  await expect(panel.getByTestId('bench-fold-groove-1')).toContainText('0°');
  await expect(panel.getByTestId('bench-fold-groove-2')).toContainText('90°');

  // fold past the V angle: target 150 deg then fully folded -> crush warning
  const target = panel.getByTestId('bench-fold-target-2');
  await target.fill('150');
  await target.press('Tab');
  await panel.getByTestId('bench-fold-groove-2').getByRole('slider').focus();
  await page.keyboard.press('End');
  await expect(panel.getByTestId('bench-fold-groove-2')).toContainText('ezilir');

  // display only: reload = flat, nothing saved by folding
  await page.reload();
  const bench2 = await openBench(page);
  await expect(bench2).toHaveAttribute('data-fold', '0');
  expect(errors).toEqual([]);
});

test('without corner relief the folded tray is red', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await acmProject(page, trayDxf('V-kanal', false));
  await openBench(page);
  const panel = page.getByTestId('bench-fold');
  await foldAll(page);
  await expect(panel.getByTestId('bench-fold-part')).toHaveAttribute('data-state', 'clash');
  await expect(issues(panel)).toBeVisible();
});

for (const layer of ['V_GROOVE', 'Büküm']) {
  test(`DXF layer "${layer}" is suggested V-kanal on ACM, not on MDF`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'makine');
    await pickOption(page.getByTestId('wizard-material'), tr.materials.acm);
    await goStep(page, 'parcalar');
    let dialog = await importDxf(page, 'a.dxf', trayDxf(layer, true));
    await expect(dialog.getByTestId(`dxf-layer-${layer}`)).toHaveAttribute('data-value', 'vgroove');
    await expect(dialog.getByTestId('dxf-layers')).toContainText(tr.dxfImport.layers.suggested);

    await openNewProject(page, 'makine');
    await goStep(page, 'parcalar');
    dialog = await importDxf(page, 'b.dxf', trayDxf(layer, true));
    await expect(dialog.getByTestId('dxf-layers')).toBeVisible();
    await expect(dialog.getByTestId(`dxf-layer-${layer}`)).not.toHaveAttribute(
      'data-value',
      'vgroove',
    );
    await expect(dialog.getByTestId('dxf-layers')).not.toContainText(tr.dxfImport.layers.suggested);
  });
}

test('390 px smoke: folded bench has no page scroll, axe clean', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await acmProject(page, trayDxf('V-kanal', true));
  await openBench(page);
  const side = await openWorkspacePanel(page, 'right');
  await side.getByTestId('bench-fold-all').getByRole('slider').focus();
  await page.keyboard.press('End');
  await expect(page.getByTestId('bench')).toHaveAttribute('data-fold', '100');
  await page.waitForTimeout(800);
  const scroll = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(scroll).toBeLessThanOrEqual(1);
  await page.screenshot({ path: 'e2e/__screenshots__/b70-tester-folded-390.png' });
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
});
