import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  chooseMachine,
  closeWorkspacePanel,
  goStep,
  nest,
  openWorkspacePanel,
  wizardReady,
  KITCHEN_3,
} from './wizard-helpers';

/**
 * T020: simulation screen drawn from the read G-code (spec §6.5). The kitchen sample is nested on
 * the parts page, then simulated on the default company's seeded example machine "Örnek router
 * (Mach3)" (preselected, D-028). The failing case creates a tiny machine through the API from the
 * seeded profile (rule 6, out of the envelope).
 */

const t = tr.cutList;
const s = tr.simulation;
/** Old URLs: they redirect into the wizard (T023). */
const PARTS = '/projeler/yeni/parcalar';
const SIM = '/projeler/yeni/simulasyon';
/** The seeded example machine (D-028). */
const SEEDED = 'Örnek router (Mach3)';

const fill = (text: string, values: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));

/** 30 pieces, 3 sheets on the 2800 × 2070 draft sheet (as in T012/T013). */
const KITCHEN = [
  'Parça adı\tEn\tBoy\tAdet\tDamar',
  'Yan\t560\t720\t8\tevet',
  'Taban\t564\t560\t4\thayır',
  'Kapak\t596\t716\t6\tevet',
  'Raf\t564\t520\t8\thayır',
  'Çekmece önü\t596\t176\t4\tevet',
].join('\n');

function watchConsole(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  return problems;
}

type Profile = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function seededProfile(request: APIRequestContext): Promise<Profile> {
  const list = (await (await request.get('/api/machines')).json()) as {
    id: string;
    name: string;
  }[];
  const seeded = list.find((m) => m.name === SEEDED) ?? list[0];
  if (!seeded) throw new Error('no seeded machine');
  const detail = (await (await request.get(`/api/machines/${seeded.id}`)).json()) as {
    profile: Profile;
  };
  return detail.profile;
}

/** Creates a tiny machine (800 × 600 travel) from the seeded profile; returns its select label. */
async function createTinyMachine(request: APIRequestContext): Promise<string> {
  const profile = await seededProfile(request);
  const name = `T020 küçük ${Math.random().toString(36).slice(2, 8)}`;
  profile.identity = { ...profile.identity, name };
  profile.workEnvelope = { x: 800, y: 600, z: 150 };
  profile.table = { width: 800, depth: 600 };
  const res = await request.post('/api/machines', { data: { profile } });
  expect(res.status()).toBe(201);
  return fill(s.machine.option, { name, version: 1 });
}

/** Desktop screenshot of the top of the page (tall viewport: the sticky banner stays in place). */
async function shot(page: Page, path: string) {
  await page.setViewportSize({ width: 1280, height: 1500 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path });
}

async function paste(page: Page, text: string, count: number) {
  await page.getByRole('button', { name: t.pasteOpen }).click();
  await page.getByLabel(t.paste.textLabel).fill(text);
  await page.getByRole('button', { name: fill(t.paste.applyCount, { count }) }).click();
  await expect(page.getByLabel(t.paste.textLabel)).toHaveCount(0);
}

/** Wizard: (machine in step 1) → kitchen sample → Diz → step 4 simulation (T023). */
async function openSimulation(page: Page, machine?: string, text = KITCHEN, count = 5) {
  await page.goto(PARTS);
  await wizardReady(page, 'parcalar');
  if (machine) {
    await goStep(page, 'makine');
    await chooseMachine(page, machine);
    await goStep(page, 'parcalar');
  }
  await paste(page, text, count);
  await nest(page);
  await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
  await goStep(page, 'simulasyon');
  await expect(page.getByTestId('sim-banner')).toContainText(s.banner);
  await expect(page.getByTestId('sim-machine-name')).toContainText(machine ?? SEEDED);
}

async function readyCanvas(page: Page) {
  const canvas = page.getByTestId('sim-canvas');
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  await expect(canvas.locator('canvas').first()).toBeVisible();
  return canvas;
}

const num = async (page: Page, attr: string) =>
  Number(await page.getByTestId('sim-canvas').getAttribute(attr));

test.describe('T020 simulation', () => {
  test('kitchen sample: summary, green check status, every move drawn at the end', async ({
    page,
  }) => {
    const problems = watchConsole(page);
    // Several plates (KITCHEN_3, T313): the tab strip and the other plates' simulation.
    await openSimulation(page, undefined, KITCHEN_3);
    await readyCanvas(page);
    const summary = page.getByTestId('sim-summary');
    await expect(summary).toBeVisible();
    // T321 (D-109): KITCHEN_3 passes with warnings (yellow chip); no blocking error is what counts here.
    await expect(page.getByTestId('sim-check-status')).toHaveText(/kontroller geçti/i);
    await expect(page.getByTestId('sim-check-status')).toHaveAttribute('data-ok', 'true');
    await expect(page.getByTestId('sim-summary-time')).toContainText('≈');
    // one tool: the first tool is set-up, no in-program change (T274)
    await expect(page.getByTestId('sim-summary-tools')).toHaveText(/^0/);
    await expect(summary).toContainText(s.summary.cutLength);
    // Four sheets (D-129 spacing with tabs), each its own tab; the banner stays visible.
    await expect(page.getByRole('tab')).toHaveCount(4);
    await expect(page.getByTestId('sim-banner')).toBeVisible();
    await expect(page.getByTestId('sim-canvas')).toHaveAttribute('data-done', '0');
    await shot(page, '__screenshots__/t020-simulasyon-baslangic.png');

    // Scrub to the end: every read move is drawn.
    const steps = await num(page, 'data-steps');
    expect(steps).toBeGreaterThan(100);
    const scrubber = page.getByTestId('sim-scrubber');
    const max = await scrubber.getAttribute('max');
    await scrubber.fill(max ?? '0');
    await expect(page.getByTestId('sim-canvas')).toHaveAttribute('data-done', String(steps));
    await expect(page.getByTestId('sim-step')).toHaveText(
      fill(s.controls.step, { n: steps, total: steps }),
    );
    await shot(page, '__screenshots__/t020-simulasyon-son.png');
    // The other sheets simulate too.
    await page.getByRole('tab').nth(1).click();
    await readyCanvas(page);
    await expect(page.getByTestId('sim-canvas')).toHaveAttribute('data-done', '0');
    expect(problems).toEqual([]);
  });

  test('play advances the scrubber; a G-code line click jumps the playhead', async ({ page }) => {
    const problems = watchConsole(page);
    await openSimulation(page);
    await readyCanvas(page);
    await page.getByRole('button', { name: s.controls.speedMax }).click();
    await page.getByTestId('sim-play').click();
    await expect(page.getByTestId('sim-canvas')).toHaveAttribute('data-playing', 'true');
    await expect.poll(() => num(page, 'data-time')).toBeGreaterThan(0);
    const scrub = Number(await page.getByTestId('sim-scrubber').inputValue());
    await expect
      .poll(async () => Number(await page.getByTestId('sim-scrubber').inputValue()))
      .toBeGreaterThan(scrub);
    // Let a few contours play before pausing (for the screenshot).
    await page.waitForTimeout(1500);
    await page.getByTestId('sim-play').click();
    await expect(page.getByTestId('sim-canvas')).toHaveAttribute('data-playing', 'false');
    await shot(page, '__screenshots__/t020-oynatma.png');

    // Click a G-code line with a cut move: the playhead lands at the end of that move.
    await page.getByRole('button', { name: s.controls.start }).click();
    const panel = page.getByTestId('gcode-panel');
    const row = panel
      .locator('button[data-line]')
      .filter({ hasText: /^Satır\s*\d+:\s*G1 / })
      .nth(3);
    const line = await row.getAttribute('data-line');
    await row.click();
    // The panel may scroll to centre the line: find the row again by its line number.
    const picked = panel.locator(`button[data-file="0"][data-line="${line}"]`);
    await expect(picked).toHaveAttribute('aria-current', 'true');
    await expect(panel).toHaveAttribute('data-current-line', line ?? '');
    expect(await num(page, 'data-done')).toBeGreaterThan(0);
    expect(await num(page, 'data-time')).toBeGreaterThan(0);
    await shot(page, '__screenshots__/t020-gcode-satiri.png');
    expect(problems).toEqual([]);
  });

  test('zoom: + four times and wheel zoom keep the sheet in view', async ({ page }) => {
    const problems = watchConsole(page);
    await openSimulation(page);
    const canvas = await readyCanvas(page);
    /** Visible part of the sheet on screen (px) per axis. */
    const visible = async () => {
      const box = await canvas.boundingBox();
      const a = async (k: string) => Number(await canvas.getAttribute(k));
      const [scale, x, y, w, h] = await Promise.all([
        a('data-scale'),
        a('data-x'),
        a('data-y'),
        a('data-sheet-width'),
        a('data-sheet-height'),
      ]);
      const cw = box?.width ?? 0;
      const ch = box?.height ?? 0;
      return {
        scale,
        x: Math.min(cw, x + w * scale) - Math.max(0, x),
        y: Math.min(ch, y + h * scale) - Math.max(0, y),
      };
    };
    // T268: CI read 0.15 / 0.19 once (flaky). Start from a settled fit (the first fit can still
    // change while the panels lay out) and wait for the four zoom steps instead of one read.
    let before = await visible();
    await expect
      .poll(async () => {
        const prev = before.scale;
        before = await visible();
        return before.scale === prev;
      })
      .toBe(true);
    for (let i = 0; i < 4; i += 1) {
      await page.getByRole('button', { name: s.controls.zoomIn }).click();
    }
    await expect.poll(async () => (await visible()).scale).toBeGreaterThan(before.scale * 2);
    const zoomed = await visible();
    expect(zoomed.x).toBeGreaterThan(40);
    expect(zoomed.y).toBeGreaterThan(40);
    // Wheel zoom at a corner, then drag far away: the sheet never leaves the canvas.
    const box = await canvas.boundingBox();
    if (!box) throw new Error('no canvas box');
    await page.mouse.move(box.x + 10, box.y + 10);
    for (let i = 0; i < 6; i += 1) await page.mouse.wheel(0, -200);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 3, box.y + box.height * 3, { steps: 5 });
    await page.mouse.up();
    const after = await visible();
    expect(after.x).toBeGreaterThan(20);
    expect(after.y).toBeGreaterThan(20);
    await page.getByRole('button', { name: s.controls.fit }).click();
    expect((await visible()).scale).toBeCloseTo(before.scale, 6);
    expect(problems).toEqual([]);
  });

  test('keyboard: →/← step, Home/End, Space plays and pauses', async ({ page }) => {
    const problems = watchConsole(page);
    await openSimulation(page);
    const canvas = await readyCanvas(page);
    await canvas.focus();
    await page.keyboard.press('ArrowRight');
    await expect(canvas).toHaveAttribute('data-done', '1');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect(canvas).toHaveAttribute('data-done', '3');
    await page.keyboard.press('ArrowLeft');
    await expect(canvas).toHaveAttribute('data-done', '2');
    await page.keyboard.press('End');
    const steps = await canvas.getAttribute('data-steps');
    await expect(canvas).toHaveAttribute('data-done', steps ?? '');
    await page.keyboard.press('Home');
    await expect(canvas).toHaveAttribute('data-done', '0');
    await expect(canvas).toHaveAttribute('data-time', '0');
    await page.keyboard.press(' ');
    await expect(canvas).toHaveAttribute('data-playing', 'true');
    await expect.poll(() => num(page, 'data-time')).toBeGreaterThan(0);
    await page.keyboard.press(' ');
    await expect(canvas).toHaveAttribute('data-playing', 'false');
    expect(await num(page, 'data-time')).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });

  test('a project outside a tiny machine: violation list, no simulation, no download', async ({
    page,
    request,
  }) => {
    const problems = watchConsole(page);
    const machine = await createTinyMachine(request);
    await openSimulation(page, machine);
    const blocked = page.getByTestId('sim-blocked');
    await expect(blocked).toBeVisible({ timeout: 30_000 });
    await expect(blocked).toContainText(s.blocked.title);
    await expect(
      blocked.locator('[data-testid=violation][data-code=OUT_OF_ENVELOPE]').first(),
    ).toBeVisible();
    await expect(blocked.locator('[data-testid=violation-group][data-rule=R6]')).toContainText(
      s.rules.R6,
    );
    await expect(blocked).toContainText(s.codes.OUT_OF_ENVELOPE);
    await expect(page.getByTestId('sim-canvas')).toHaveCount(0);
    await expect(page.getByTestId('sim-summary')).toHaveCount(0);
    await expect(page.locator('a[download]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /indir/i })).toHaveCount(0);
    await expect(page.getByTestId('sim-banner')).toBeVisible();
    await shot(page, '__screenshots__/t020-indirilemez.png');
    expect(problems).toEqual([]);
  });

  test('without a layout the page shows the empty state', async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto(SIM);
    await wizardReady(page, 'simulasyon');
    await expect(page.getByTestId('sim-empty')).toContainText(tr.wizard.simulation.empty);
    await expect(page.getByTestId('sim-banner')).toBeVisible();
    await page.getByRole('button', { name: tr.wizard.simulation.toLayout }).click();
    await wizardReady(page, 'dizilim');
    expect(problems).toEqual([]);
  });

  test('back to the layout step keeps the cut list and the layout', async ({ page }) => {
    await openSimulation(page);
    await readyCanvas(page);
    await page.getByTestId('wizard-back').click();
    await wizardReady(page, 'dizilim');
    await expect(page.getByTestId('layout-canvas')).toBeVisible();
    await expect(page.getByTestId('nesting-sheets')).toHaveText('3');
  });

  test('390 px: canvas first, G-code panel in a sheet, no horizontal page scroll', async ({
    page,
  }) => {
    const problems = watchConsole(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await openSimulation(page);
    const canvas = await readyCanvas(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await canvas.boundingBox();
    expect(box?.width ?? 999).toBeLessThanOrEqual(390);
    // T198: the G-code panel lives in a bottom sheet on phones.
    await page.getByRole('button', { name: s.controls.end }).click();
    const sheet = await openWorkspacePanel(page, 'right');
    const panel = await sheet.getByTestId('gcode-panel').boundingBox();
    expect((panel?.x ?? 0) + (panel?.width ?? 999)).toBeLessThanOrEqual(390);
    await closeWorkspacePanel(page);
    await canvas.scrollIntoViewIfNeeded();
    await page.screenshot({ path: '__screenshots__/t020-mobil.png' });
    expect(problems).toEqual([]);
  });

  test('reduced motion: no playback animation, steps jump instantly', async ({ page }) => {
    const problems = watchConsole(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openSimulation(page);
    const canvas = await readyCanvas(page);
    // T245: the note sits behind an info icon; "Oynat" stays enabled and steps once.
    await expect(page.getByTestId('sim-reduced-note')).toHaveCount(0);
    await page.getByTestId('sim-reduced-info').click();
    await expect(page.getByTestId('sim-reduced-note')).toHaveText(s.controls.reducedMotion);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('sim-play')).toBeEnabled();
    await canvas.focus();
    await page.keyboard.press(' ');
    await expect(canvas).toHaveAttribute('data-done', '1');
    await expect(canvas).toHaveAttribute('data-playing', 'false');
    const t0 = await num(page, 'data-time');
    await page.waitForTimeout(400);
    expect(await num(page, 'data-time')).toBe(t0);
    await page.getByRole('button', { name: s.controls.next }).click();
    await expect(canvas).toHaveAttribute('data-done', '2');
    await page.getByTestId('sim-play').click();
    await expect(canvas).toHaveAttribute('data-done', '3');
    await expect(canvas).toHaveAttribute('data-playing', 'false');
    await shot(page, '__screenshots__/t020-hareketi-azalt.png');
    expect(problems).toEqual([]);
  });

  test('300 parts simulate and scrub smoothly', async ({ page }) => {
    test.setTimeout(90_000);
    const problems = watchConsole(page);
    const rows = ['Ad\tEn\tBoy\tAdet'];
    for (let i = 0; i < 30; i += 1) rows.push(`P${i + 1}\t${120 + 7 * i}\t${90 + 5 * i}\t10`);
    await openSimulation(page, undefined, rows.join('\n'), 30);
    const canvas = await readyCanvas(page);
    await expect(page.getByTestId('sim-check-status')).toHaveAttribute('data-ok', 'true');
    const scrubber = page.getByTestId('sim-scrubber');
    const max = Number(await scrubber.getAttribute('max'));
    const t0 = Date.now();
    for (let i = 1; i <= 10; i += 1) await scrubber.fill(String(Math.round((max * i) / 10)));
    await expect(canvas).toHaveAttribute(
      'data-done',
      (await canvas.getAttribute('data-steps')) ?? '',
    );
    expect(Date.now() - t0).toBeLessThan(5000);
    await shot(page, '__screenshots__/t020-300-parca.png');
    expect(problems).toEqual([]);
  });
});
