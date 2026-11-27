import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  chooseMachine,
  fill,
  goStep,
  openNewProject,
  pasteAndNest,
  pickOption,
  saved,
  watchConsole,
} from './wizard-helpers';

// B44 tester (D-080): fit to job in Dizilim / Simülasyon / 3D, no view jump on drag, "45° kazanç
// yok" and part-in-hole lines, Kesim ayarları on 18 mm and 1.5 mm sheets, no THREE.Clock warning.
test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] } });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __nittcam3dNoAuto: boolean }).__nittcam3dNoAuto = true;
  });
});

const l = tr.layout;
const SHOTS = '__screenshots__/b44-tester';
const SMALL = 'Ad\tEn\tBoy\tAdet\nHarf A\t200\t150\t1\nHarf B\t180\t150\t1';

async function view(page: Page, id: string) {
  const box = page.getByTestId(id);
  const n = async (a: string) => Number(await box.getAttribute(a));
  return { scale: await n('data-scale'), x: await n('data-x'), y: await n('data-y') };
}

/** "1.234,5" → 1234.5 */
const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

test('Dizilim small job: opens on the job, Tümünü göster / İşe sığdır, drag keeps the view, part-in-hole line', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const problems = watchConsole(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page, SMALL, 2);
  const canvas = page.getByTestId('layout-canvas');
  await expect(canvas).toHaveAttribute('data-part-count', '2');
  await expect(page.getByTestId('layout-fit-job')).toBeVisible();
  await expect.poll(async () => (await view(page, 'layout-canvas')).scale).toBeGreaterThan(0);
  const job = await view(page, 'layout-canvas');
  await page.screenshot({ path: `${SHOTS}/dizilim-small-job-1440.png` });

  await page.getByRole('button', { name: l.fit, exact: true }).click();
  await expect
    .poll(async () => (await view(page, 'layout-canvas')).scale)
    .toBeLessThan(job.scale / 1.5);
  await page.getByTestId('layout-fit-job').click();
  await expect
    .poll(async () => (await view(page, 'layout-canvas')).scale)
    .toBeCloseTo(job.scale, 3);
  // key 0 on the canvas goes back to the job too
  await page.getByRole('button', { name: l.fit, exact: true }).click();
  await canvas.focus();
  await page.keyboard.press('0');
  await expect
    .poll(async () => (await view(page, 'layout-canvas')).scale)
    .toBeCloseTo(job.scale, 3);

  // Part-in-hole on with plain rectangles: "İç boşluğa 0 parça".
  await page.getByTestId('layout-part-in-hole').click();
  await page
    .locator(
      'button[data-testid^="layout-mode-"][aria-pressed="true"]:visible, [data-testid="layout-nest-compact"]:visible',
    )
    .click();
  await expect(page.getByTestId('layout-part-in-hole-result')).toHaveText(
    tr.wizard.layout.partInHoleNone,
    { timeout: 30_000 },
  );
  await page.screenshot({ path: `${SHOTS}/dizilim-gain-lines-1440.png` });

  // Drag a part: the view does not move (no refit on drag, D-080).
  await pickOption(page.getByTestId('layout-select'), { index: 1 });
  const pos = await page.getByTestId('layout-info-position').innerText();
  const size = await page.getByTestId('layout-info-size').innerText();
  const m = /X ([\d.,-]+) · Y ([\d.,-]+) mm/.exec(pos);
  const s = /([\d.,]+) × ([\d.,]+) mm/.exec(size);
  if (!m || !s) throw new Error(`cannot read ${pos} / ${size}`);
  const cx = num(m[1] ?? '') + num(s[1] ?? '') / 2;
  const cy = num(m[2] ?? '') + num(s[2] ?? '') / 2;
  const before = await view(page, 'layout-canvas');
  const sheetH = Number(await canvas.getAttribute('data-sheet-height'));
  const cb = await page.locator('[data-testid=layout-canvas] canvas').first().boundingBox();
  if (!cb) throw new Error('no canvas');
  const sx = cb.x + before.x + cx * before.scale;
  const sy = cb.y + before.y + (sheetH - cy) * before.scale;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 5, sy + 5, { steps: 2 });
  // 100 mm to the right: free sheet, still on screen (the two parts are stacked)
  await page.mouse.move(sx + 100 * before.scale, sy, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByTestId('layout-info-position')).not.toHaveText(pos);
  expect(await view(page, 'layout-canvas')).toEqual(before);

  expect(problems).toEqual([]);
});

test('Simülasyon and 3D small job: framed on the job, fit buttons, one-row Kesim ayarları, no Clock warning', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const warnings: string[] = [];
  page.on('console', (msg) => {
    if (/THREE\.Clock|Clock.*deprecated/i.test(msg.text())) warnings.push(msg.text());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page, SMALL, 2);
  await saved(page);

  // 3D on Dizilim
  await page.getByTestId('view-3d').click();
  const host = page.getByTestId('preview3d');
  await expect(host).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
  await expect(page.getByTestId('preview3d-fit-sheet')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/preview3d-small-job-1440.png` });
  await page.getByTestId('preview3d-fit-sheet').click();
  await page.screenshot({ path: `${SHOTS}/preview3d-fit-sheet-1440.png` });
  await page.getByTestId('view-2d').click();

  await goStep(page, 'simulasyon');
  await expect(page.getByTestId('sim-check-status')).toHaveAttribute('data-ok', 'true', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('sim-fit-job')).toBeVisible();
  await expect.poll(async () => (await view(page, 'sim-canvas')).scale).toBeGreaterThan(0);
  const job = await view(page, 'sim-canvas');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${SHOTS}/sim-small-job-1440.png` });
  await page.getByRole('button', { name: tr.simulation.controls.fit, exact: true }).click();
  await expect
    .poll(async () => (await view(page, 'sim-canvas')).scale)
    .toBeLessThan(job.scale / 1.5);
  await page.getByTestId('sim-fit-job').click();
  await expect.poll(async () => (await view(page, 'sim-canvas')).scale).toBeCloseTo(job.scale, 3);

  // Kesim ayarları on 18 mm: the three tab fields share one row; 17,9 → "Çok yüksek".
  const panel = page.getByTestId('sim-cutting');
  const ys = await Promise.all(
    ['sim-cutting-width', 'sim-cutting-height', 'sim-cutting-count'].map(
      async (id) => (await page.getByTestId(id).boundingBox())?.y ?? -1,
    ),
  );
  expect(Math.max(...ys) - Math.min(...ys)).toBeLessThan(2);
  const height = page.getByTestId('sim-cutting-height');
  await height.fill('17,9');
  await height.press('Enter');
  await expect(
    panel.getByText(fill(tr.simulation.cutting.bounds.heightHigh, { max: '17' })),
  ).toBeVisible();
  await expect(panel.getByTestId('field-in-use').first()).toBeVisible();
  await panel.scrollIntoViewIfNeeded();
  await panel.screenshot({ path: `${SHOTS}/kesim-ayarlari-18mm.png` });

  // 3D in Simülasyon
  await page.getByTestId('sim-view-3d').click();
  await expect(page.getByTestId('preview3d')).toHaveAttribute('data-ready', 'true', {
    timeout: 30_000,
  });
  await page.waitForTimeout(500);
  expect(warnings).toEqual([]);
});

async function thinMachine(request: APIRequestContext, name: string) {
  const list = (await (await request.get('/api/machines')).json()) as { id: string }[];
  const first = list[0];
  if (!first) throw new Error('no seeded machine');
  const seeded = (await (await request.get(`/api/machines/${first.id}`)).json()) as {
    profile: Record<string, unknown> & {
      identity: Record<string, unknown>;
      materials: Record<string, unknown>[];
    };
  };
  const profile = structuredClone(seeded.profile);
  profile.example = false;
  profile.identity = { ...profile.identity, name };
  profile.materials = [
    ...profile.materials,
    {
      material: 'acrylic',
      thickness: 1.5,
      feed: 3000,
      plungeFeed: 1000,
      rpm: 18000,
      stepDown: 1.5,
      tool: 1,
    },
  ];
  const res = await request.post('/api/machines', { data: { profile } });
  expect(res.status(), await res.text()).toBe(201);
}

test('Kesim ayarları on a 1.5 mm sheet: "köprü bırakılamaz", no reversed range', async ({
  page,
}) => {
  test.setTimeout(150_000);
  const name = `B44 ince ${Date.now()}`;
  await thinMachine(page.request, name);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'makine');
  await chooseMachine(page, name);
  await pickOption(page.getByTestId('wizard-material'), tr.materials.acrylic);
  const thick = page.getByTestId('wizard-thickness');
  await thick.fill('1,5');
  await thick.press('Enter');
  await expect(page.getByTestId('no-cutting-params')).toHaveCount(0);
  await goStep(page, 'parcalar');
  await pasteAndNest(page, SMALL, 2);
  await saved(page);
  await goStep(page, 'simulasyon');
  const panel = page.getByTestId('sim-cutting');
  await expect(panel).toBeVisible({ timeout: 30_000 });
  const none = fill(tr.simulation.cutting.bounds.heightNone, { thickness: '1,5', need: '2' });
  const height = page.getByTestId('sim-cutting-height');
  await height.fill('1');
  await height.press('Enter');
  await expect(panel.getByText(none).first()).toBeVisible();
  await expect(panel).not.toContainText(/1\s*–\s*0,5 mm/);
  await panel.scrollIntoViewIfNeeded();
  await panel.screenshot({ path: `${SHOTS}/kesim-ayarlari-1_5mm.png` });
});

for (const [w, h] of [
  [1440, 900],
  [1024, 768],
] as const) {
  test(`assembly 3D at ${w}: whole cabinet in the first view, doors and hinge cups`, async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const c = tr.cutList.cabinet;
    await page.setViewportSize({ width: w, height: h });
    await openNewProject(page, 'parcalar');
    await page.getByTestId('cabinet-open').click();
    const dialog = page.getByTestId('cabinet-dialog');
    await page.getByTestId('cabinet-width').fill('900');
    await dialog.getByRole('radio', { name: c.doorCount[2] }).click();
    await page.getByTestId('cabinet-add').click();
    await expect(dialog).toHaveCount(0);
    // Hinge cups need the drawing side panel (inline at 1440 only; 1024 has bottom sheets).
    if (w === 1440) {
      await page.getByTestId('parts-view-drawing').click();
      await expect(page.getByTestId('editor-canvas')).toHaveAttribute('data-view', /\d/);
      await page
        .getByTestId('editor-part-list')
        .getByRole('button')
        .filter({ hasText: c.roles.door })
        .last()
        .click();
      await page.getByTestId('template-add').click();
      await page
        .getByTestId('template-menu-item')
        .filter({ hasText: 'Menteşe çukuru Ø35 (2 menteşe)' })
        .click();
      await page.getByTestId('template-place').click();
      await expect(page.getByTestId('template-pending')).toBeHidden();
    }
    await goStep(page, 'dizilim');
    // Below 1280 the left panel starts collapsed (T241): open it for Diz, then close it again.
    const left = page.getByTestId('workspace-left');
    const wasClosed = (await left.getAttribute('data-state')) === 'closed';
    if (wasClosed) await page.getByTestId('workspace-left-toggle').click();
    await left
      .locator(
        'button[data-testid^="layout-mode-"][aria-pressed="true"]:visible, [data-testid="layout-nest-compact"]:visible',
      )
      .click();
    if (wasClosed) await page.getByTestId('workspace-left-toggle').click();
    await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: `${SHOTS}/dizilim-cabinet-labels-${w}.png` });
    await page.getByTestId('view-3d').click();
    const host = page.getByTestId('preview3d');
    await expect(host).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
    const toggle = page.getByTestId('preview3d-assembly');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
    await expect(page.getByTestId('preview3d-assembly-canvas')).toBeVisible();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/assembly-${w}.png` });
  });
}

test('45° kazanç yok: default 90° nest, then 45° with the same result (B44 item 3)', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page, SMALL, 2);
  await expect(page.getByTestId('layout-canvas')).toHaveAttribute('data-part-count', '2');
  await expect(page.getByTestId('layout-rotation-gain')).toHaveCount(0);
  const w = tr.wizard.layout;
  await page.getByRole('radio', { name: w.rotations.step45, exact: true }).click();
  await page
    .locator(
      'button[data-testid^="layout-mode-"][aria-pressed="true"]:visible, [data-testid="layout-nest-compact"]:visible',
    )
    .click();
  // Same sheet count and waste (waste = sheet − part area): no gain.
  await expect(page.getByTestId('layout-rotation-gain')).toHaveText(
    fill(w.rotationNoGain, { angle: 45 }),
    { timeout: 30_000 },
  );
});
