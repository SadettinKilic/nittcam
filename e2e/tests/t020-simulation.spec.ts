import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };

/**
 * T020: simulation screen drawn from the read G-code (spec §6.5). The kitchen sample is nested on
 * the parts page, then simulated on a machine of the default company. The seeded example machine
 * cannot export the draft sheet (generic post with a manual changer, 2500 × 1300 travel; see
 * D-028), so the tests create machines through the API from the seeded profile: a large Mach3
 * machine (passes) and a tiny one (fails, rule 6).
 */

const t = tr.cutList;
const s = tr.simulation;
const PARTS = '/projeler/yeni/parcalar';
const SIM = '/projeler/yeni/simulasyon';

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
  const seeded = list.find((m) => m.name === 'Genel düz G-code router') ?? list[0];
  if (!seeded) throw new Error('no seeded machine');
  const detail = (await (await request.get(`/api/machines/${seeded.id}`)).json()) as {
    profile: Profile;
  };
  return detail.profile;
}

/** Creates a machine from the seeded profile; returns its select label. */
async function createMachine(request: APIRequestContext, kind: 'large' | 'tiny'): Promise<string> {
  const profile = await seededProfile(request);
  const name = `T020 ${kind === 'large' ? 'büyük' : 'küçük'} ${Math.random().toString(36).slice(2, 8)}`;
  profile.identity = { ...profile.identity, name };
  profile.post = { id: 'mach3', version: '1.0.0' };
  if (kind === 'large') {
    profile.workEnvelope = { x: 3100, y: 2200, z: 150 };
    profile.table = { width: 3050, depth: 2150 };
  } else {
    profile.workEnvelope = { x: 800, y: 600, z: 150 };
    profile.table = { width: 800, depth: 600 };
  }
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

/** Kitchen sample → nest → "Simülasyona geç" → choose the machine. */
async function openSimulation(page: Page, machine: string, text = KITCHEN, count = 5) {
  await page.goto(PARTS);
  await paste(page, text, count);
  await page.getByRole('button', { name: t.nesting.run, exact: true }).click();
  await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('open-simulation').click();
  await expect(page).toHaveURL(SIM);
  await expect(page.getByTestId('sim-banner')).toContainText(s.banner);
  await page.getByTestId('sim-machine').selectOption({ label: machine });
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
    request,
  }) => {
    const problems = watchConsole(page);
    const machine = await createMachine(request, 'large');
    await openSimulation(page, machine);
    await readyCanvas(page);
    const summary = page.getByTestId('sim-summary');
    await expect(summary).toBeVisible();
    await expect(page.getByTestId('sim-check-status')).toHaveText(new RegExp(s.summary.checksOk));
    await expect(page.getByTestId('sim-check-status')).toHaveAttribute('data-ok', 'true');
    await expect(page.getByTestId('sim-summary-time')).toContainText('≈');
    await expect(page.getByTestId('sim-summary-tools')).toHaveText(/^[1-9]/);
    await expect(summary).toContainText(s.summary.cutLength);
    // Three sheets, each its own tab; the banner stays visible.
    await expect(page.getByRole('tab')).toHaveCount(3);
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

  test('play advances the scrubber; a G-code line click jumps the playhead', async ({
    page,
    request,
  }) => {
    const problems = watchConsole(page);
    const machine = await createMachine(request, 'large');
    await openSimulation(page, machine);
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
      .filter({ hasText: /^\d+\s*G1 / })
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

  test('keyboard: →/← step, Home/End, Space plays and pauses', async ({ page, request }) => {
    const problems = watchConsole(page);
    const machine = await createMachine(request, 'large');
    await openSimulation(page, machine);
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
    const machine = await createMachine(request, 'tiny');
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
    await expect(page.getByTestId('sim-empty')).toContainText(s.empty.title);
    await expect(page.getByTestId('sim-banner')).toBeVisible();
    await page.getByRole('link', { name: s.empty.action }).click();
    await expect(page).toHaveURL(PARTS);
    expect(problems).toEqual([]);
  });

  test('back to the parts page keeps the cut list and the layout', async ({ page, request }) => {
    const machine = await createMachine(request, 'large');
    await openSimulation(page, machine);
    await readyCanvas(page);
    await page.getByRole('link', { name: s.back }).click();
    await expect(page).toHaveURL(PARTS);
    await expect(page.getByTestId('layout-canvas')).toBeVisible();
    await expect(page.getByTestId('nesting-sheets')).toHaveText('3');
  });

  test('390 px: canvas fits, panels stack, no horizontal page scroll', async ({
    page,
    request,
  }) => {
    const problems = watchConsole(page);
    const machine = await createMachine(request, 'large');
    await page.setViewportSize({ width: 390, height: 844 });
    await openSimulation(page, machine);
    const canvas = await readyCanvas(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const box = await canvas.boundingBox();
    expect(box?.width ?? 999).toBeLessThanOrEqual(390);
    // The G-code panel sits below the canvas.
    const panel = await page.getByTestId('gcode-panel').boundingBox();
    expect((panel?.y ?? 0) > (box?.y ?? 0) + (box?.height ?? 0)).toBe(true);
    await page.getByRole('button', { name: s.controls.end }).click();
    await canvas.scrollIntoViewIfNeeded();
    await page.screenshot({ path: '__screenshots__/t020-mobil.png' });
    expect(problems).toEqual([]);
  });

  test('reduced motion: no playback animation, steps jump instantly', async ({ page, request }) => {
    const problems = watchConsole(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const machine = await createMachine(request, 'large');
    await openSimulation(page, machine);
    const canvas = await readyCanvas(page);
    await expect(page.getByTestId('sim-reduced-note')).toBeVisible();
    await expect(page.getByTestId('sim-play')).toBeDisabled();
    await canvas.focus();
    await page.keyboard.press(' ');
    await expect(canvas).toHaveAttribute('data-done', '1');
    await expect(canvas).toHaveAttribute('data-playing', 'false');
    const t0 = await num(page, 'data-time');
    await page.waitForTimeout(400);
    expect(await num(page, 'data-time')).toBe(t0);
    await page.getByRole('button', { name: s.controls.next }).click();
    await expect(canvas).toHaveAttribute('data-done', '2');
    await shot(page, '__screenshots__/t020-hareketi-azalt.png');
    expect(problems).toEqual([]);
  });

  test('300 parts simulate and scrub smoothly', async ({ page, request }) => {
    test.setTimeout(90_000);
    const problems = watchConsole(page);
    const machine = await createMachine(request, 'large');
    const rows = ['Ad\tEn\tBoy\tAdet'];
    for (let i = 0; i < 30; i += 1) rows.push(`P${i + 1}\t${120 + 7 * i}\t${90 + 5 * i}\t10`);
    await openSimulation(page, machine, rows.join('\n'), 30);
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
