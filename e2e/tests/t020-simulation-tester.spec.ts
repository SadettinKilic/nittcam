import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { chooseMachine, goStep, nest, saved, wizardReady } from './wizard-helpers';

/**
 * T020 tester: the simulation screen as a user sees it. Complements the dev spec: line/playhead
 * agreement against the G-code text, seek vs tool position, speed 10x, draft survival across a
 * reload, 320/768 px, the strings check against tr.json, responsiveness with 300 parts.
 */
const t = tr.cutList;
const s = tr.simulation;
const PARTS = '/projeler/yeni/parcalar';
const SEEDED = 'Örnek router (Mach3)';

const fill = (text: string, v: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => (k in v ? String(v[k]) : m));

const KITCHEN = [
  'Parça adı\tEn\tBoy\tAdet\tDamar',
  'Yan\t560\t720\t8\tevet',
  'Taban\t564\t560\t4\thayır',
  'Kapak\t596\t716\t6\tevet',
  'Raf\t564\t520\t8\thayır',
  'Çekmece önü\t596\t176\t4\tevet',
].join('\n');

function watch(page: Page): string[] {
  const p: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') p.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => p.push(`pageerror: ${e.message}`));
  return p;
}

async function toSimulation(page: Page, text = KITCHEN, count = 5, machine?: string) {
  await page.goto(PARTS);
  await wizardReady(page, 'parcalar');
  if (machine) {
    await goStep(page, 'makine');
    await chooseMachine(page, machine);
    await goStep(page, 'parcalar');
  }
  await page.getByRole('button', { name: t.pasteOpen }).click();
  await page.getByLabel(t.paste.textLabel).fill(text);
  await page.getByRole('button', { name: fill(t.paste.applyCount, { count }) }).click();
  await expect(page.getByLabel(t.paste.textLabel)).toHaveCount(0);
  await nest(page);
  await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
  await goStep(page, 'simulasyon');
}

async function ready(page: Page) {
  const c = page.getByTestId('sim-canvas');
  await expect(c).toBeVisible({ timeout: 30_000 });
  return c;
}

/** Turkish number text "1.234,5" -> 1234.5. */
const trNum = (x: string) => Number(x.replace(/\./g, '').replace(',', '.').replace('−', '-'));

function readout(text: string) {
  const m = /X (\S+) · Y (\S+) · Z (\S+) mm/.exec(text);
  if (!m) return null;
  return { x: trNum(m[1] ?? ''), y: trNum(m[2] ?? ''), z: trNum(m[3] ?? '') };
}

const word = (text: string, w: string) => {
  const m = new RegExp(`${w}(-?\\d+(?:\\.\\d+)?)`).exec(text.replace(/\(.*?\)/g, ''));
  return m ? Number(m[1]) : null;
};

const summaryNum = async (page: Page, key: string) =>
  trNum(((await page.getByTestId(`sim-summary-${key}`).textContent()) ?? '0').trim());

test.describe('T020 tester: simulation UX', () => {
  test('fresh DB flow: green status, summary numbers, banner, legend, z strip', async ({
    page,
  }) => {
    const problems = watch(page);
    await toSimulation(page);
    await ready(page);
    await expect(page.getByTestId('sim-banner')).toContainText(s.banner);
    await expect(page.getByTestId('sim-check-status')).toHaveAttribute('data-ok', 'true');
    for (const k of ['time', 'cut', 'rapid', 'tools', 'passes', 'tabs']) {
      const el = page.getByTestId(`sim-summary-${k}`);
      await expect(el).toBeVisible();
      expect(((await el.textContent()) ?? '').trim().length).toBeGreaterThan(0);
    }
    console.log(
      `kitchen: tabs=${await summaryNum(page, 'tabs')} passes=${await summaryNum(page, 'passes')}`,
    );
    expect(await summaryNum(page, 'passes')).toBeGreaterThan(0);
    await expect(page.getByText(s.legend.cut, { exact: true })).toBeVisible();
    await expect(page.getByText(s.legend.depthTop)).toBeVisible();
    await expect(page.getByText(s.legend.tabMarker)).toBeVisible();
    await expect(page.getByTestId('z-strip')).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('tabs: counted in the summary and the canvas shows more than one depth shade', async ({
    page,
  }) => {
    await toSimulation(page);
    const canvas = await ready(page);
    await page.getByRole('button', { name: s.controls.end }).click();
    const tabs = await summaryNum(page, 'tabs');
    expect(tabs).toBeGreaterThan(0);
    const stats = await canvas
      .locator('canvas')
      .first()
      .evaluate((c) => {
        const cv = c as HTMLCanvasElement;
        const d = cv.getContext('2d')?.getImageData(0, 0, cv.width, cv.height).data;
        const counts = new Map<string, number>();
        if (d) {
          for (let i = 0; i < d.length; i += 4) {
            const k = `${d[i]},${d[i + 1]},${d[i + 2]}`;
            counts.set(k, (counts.get(k) ?? 0) + 1);
          }
        }
        return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25);
      });
    console.log('top colours', JSON.stringify(stats.slice(0, 12)));
    expect(stats.length).toBeGreaterThan(3);
    await page.screenshot({ path: '__screenshots__/t020-tester-son.png' });
  });

  test('highlighted G-code line matches the move at the playhead (60 steps)', async ({ page }) => {
    await toSimulation(page);
    const canvas = await ready(page);
    await canvas.focus();
    const panel = page.getByTestId('gcode-panel');
    const total = (await canvas.getAttribute('data-steps')) ?? '';
    let lastLine = 0;
    for (let n = 1; n <= 60; n += 1) {
      await page.keyboard.press('ArrowRight');
      await expect(canvas).toHaveAttribute('data-done', String(n));
      const line = Number(await panel.getAttribute('data-current-line'));
      expect(line).toBeGreaterThan(lastLine);
      lastLine = line;
      const row = panel.locator(`button[data-file="0"][data-line="${line}"]`);
      await expect(row).toHaveAttribute('aria-current', 'true');
      const text = (await row.getAttribute('data-text')) ?? '';
      expect(text).toMatch(/^(N\d+ )?G0?[0-3]\b/);
      const pos = readout((await page.getByTestId('sim-position').textContent()) ?? '');
      expect(pos).not.toBeNull();
      // This machine: front-left, no offset, Z zero = material top, so machine = sheet frame.
      const x = word(text, 'X');
      const y = word(text, 'Y');
      const z = word(text, 'Z');
      if (x !== null) expect(pos?.x).toBeCloseTo(x, 0);
      if (y !== null) expect(pos?.y).toBeCloseTo(y, 0);
      if (z !== null) expect(pos?.z).toBeCloseTo(z, 0);
      await expect(page.getByTestId('sim-step')).toHaveText(fill(s.controls.step, { n, total }));
    }
  });

  test('clicking a G-code line seeks: tool position = that move end point', async ({ page }) => {
    await toSimulation(page);
    const canvas = await ready(page);
    const panel = page.getByTestId('gcode-panel');
    const rows = panel.locator('button[data-line]').filter({ hasText: /^Satır\s*\d+:\s*G[123] / });
    for (const idx of [2, 5, 9]) {
      const row = rows.nth(idx);
      const line = (await row.getAttribute('data-line')) ?? '';
      const text = (await row.getAttribute('data-text')) ?? '';
      await row.click();
      await expect(panel).toHaveAttribute('data-current-line', line);
      const pos = readout((await page.getByTestId('sim-position').textContent()) ?? '');
      const x = word(text, 'X');
      const y = word(text, 'Y');
      if (x !== null) expect(pos?.x).toBeCloseTo(x, 0);
      if (y !== null) expect(pos?.y).toBeCloseTo(y, 0);
      expect(Number(await canvas.getAttribute('data-done'))).toBeGreaterThan(0);
    }
  });

  test('speed 10x advances faster than 1x; pause freezes the scrubber', async ({ page }) => {
    await toSimulation(page);
    const canvas = await ready(page);
    const rate = async (label: string) => {
      const btn = page.getByRole('button', { name: label, exact: true });
      await btn.click();
      await expect(btn).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: s.controls.start }).click();
      await page.getByTestId('sim-play').click();
      await expect(canvas).toHaveAttribute('data-playing', 'true');
      await page.waitForTimeout(1200);
      await page.getByTestId('sim-play').click();
      await expect(canvas).toHaveAttribute('data-playing', 'false');
      return Number(await canvas.getAttribute('data-time'));
    };
    const slow = await rate('1×');
    const fast = await rate('10×');
    console.log(`sim seconds in 1.2 s wall: 1x=${slow} 10x=${fast}`);
    expect(fast).toBeGreaterThan(slow * 4);
    const frozen = await canvas.getAttribute('data-time');
    await page.waitForTimeout(500);
    await expect(canvas).toHaveAttribute('data-time', frozen ?? '');
  });

  test('failed project: grouped Turkish list, no canvas, no download control', async ({
    page,
    request,
  }) => {
    const problems = watch(page);
    const list = (await (await request.get('/api/machines')).json()) as {
      id: string;
      name: string;
    }[];
    const seed = list.find((m) => m.name === SEEDED) ?? list[0];
    const detail = (await (await request.get(`/api/machines/${seed?.id}`)).json()) as {
      profile: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    };
    const profile = detail.profile;
    const name = `T020 tester küçük ${Math.random().toString(36).slice(2, 7)}`;
    profile.identity = { ...profile.identity, name };
    profile.workEnvelope = { x: 800, y: 600, z: 150 };
    profile.table = { width: 800, depth: 600 };
    expect((await request.post('/api/machines', { data: { profile } })).status()).toBe(201);
    await toSimulation(page, KITCHEN, 5, name);
    const blocked = page.getByTestId('sim-blocked');
    await expect(blocked).toBeVisible({ timeout: 30_000 });
    const groups = blocked.locator('[data-testid=violation-group]');
    expect(await groups.count()).toBeGreaterThanOrEqual(1);
    await expect(blocked).toContainText(s.blocked.title);
    console.log('BLOCKED TEXT:', (await blocked.innerText()).replace(/\s+/g, ' ').slice(0, 900));
    await expect(page.getByTestId('sim-canvas')).toHaveCount(0);
    await expect(page.locator('a[download], a[href$=".nc"], a[href*="export"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /indir|download|export/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /indir|download/i })).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('draft survives a reload of the simulation page, and going back', async ({ page }) => {
    await toSimulation(page);
    await ready(page);
    await saved(page);
    await page.reload();
    await ready(page);
    await expect(page.getByTestId('sim-check-status')).toHaveAttribute('data-ok', 'true');
    await page.getByTestId('wizard-back').click();
    await wizardReady(page, 'dizilim');
    await expect(page.getByTestId('layout-canvas')).toBeVisible();
    await expect(page.getByTestId('nesting-sheets')).toHaveText('3');
  });

  // Was a known bug in round 1 (an empty editor saved over the stored draft); fixed (D-028).
  test('the project survives a reload of the layout step (server, T023)', async ({ page }) => {
    await toSimulation(page);
    await ready(page);
    await saved(page);
    await page.getByTestId('wizard-back').click();
    await expect(page.getByTestId('layout-canvas')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByTestId('nesting-sheets')).toHaveText('3');
  });

  test('no autoplay on load, with and without reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await toSimulation(page);
    const canvas = await ready(page);
    await page.waitForTimeout(1000);
    await expect(canvas).toHaveAttribute('data-playing', 'false');
    await expect(canvas).toHaveAttribute('data-time', '0');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.reload();
    const again = await ready(page);
    await page.waitForTimeout(800);
    await expect(again).toHaveAttribute('data-playing', 'false');
    await expect(again).toHaveAttribute('data-time', '0');
  });

  for (const w of [320, 390, 768]) {
    test(`${w} px: no page-level horizontal scroll, panels stack`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 900 });
      await toSimulation(page);
      const canvas = await ready(page);
      await page.getByRole('button', { name: s.controls.end }).click();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      const box = await canvas.boundingBox();
      const panel = await page.getByTestId('gcode-panel').boundingBox();
      expect(box?.width ?? 999).toBeLessThanOrEqual(w);
      expect((panel?.y ?? 0) >= (box?.y ?? 0) + (box?.height ?? 0)).toBe(true);
      const play = await page.getByTestId('sim-play').boundingBox();
      expect((play?.x ?? 0) + (play?.width ?? 0)).toBeLessThanOrEqual(w + 1);
      await page.screenshot({ path: `__screenshots__/t020-tester-${w}.png` });
    });
  }

  test('all visible strings come from tr.json', async ({ page }) => {
    await toSimulation(page);
    await ready(page);
    const leaves: string[] = [];
    const walk = (o: unknown) => {
      if (typeof o === 'string') leaves.push(o);
      else if (o && typeof o === 'object') Object.values(o).forEach(walk);
    };
    walk(tr);
    const esc = (x: string) => x.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
    const patterns = leaves.map(
      (l) =>
        new RegExp(
          `^${esc(l)
            .replace(/\{\w+\}/g, '.*')
            .replace(/\s+/g, '\\s*')}$`,
          's',
        ),
    );
    const texts = await page.evaluate(() => {
      const out: string[] = [];
      const skip = (el: Element | null): boolean =>
        !!el?.closest(
          '[data-testid=gcode-panel], select, script, style, [aria-hidden=true], .sr-only',
        );
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const v = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (v && /[A-Za-zÇĞİÖŞÜçğıöşü]{2}/.test(v) && !skip(n.parentElement)) out.push(v);
      }
      return out;
    });
    const stray = texts.filter((v) => !patterns.some((p) => p.test(v.replace(/^[·\s]+/, ''))));
    console.log('STRAY TEXTS:', JSON.stringify(stray));
    expect(stray).toEqual([]);
  });

  test('300 parts: responsive while loading, scrubbing < 5 s', async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => {
      const w = window as unknown as { __long: number[] };
      w.__long = [];
      try {
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) w.__long.push(e.duration);
        }).observe({ entryTypes: ['longtask'] });
      } catch {
        /* unsupported */
      }
    });
    const rows = ['Ad\tEn\tBoy\tAdet'];
    for (let i = 0; i < 30; i += 1) rows.push(`P${i + 1}\t${120 + 7 * i}\t${90 + 5 * i}\t10`);
    await toSimulation(page, rows.join('\n'), 30);
    const gaps = await page.evaluate(
      () =>
        new Promise<number[]>((res) => {
          const g: number[] = [];
          let last = performance.now();
          const end = last + 1500;
          const tick = (n: number) => {
            g.push(n - last);
            last = n;
            if (n < end) requestAnimationFrame(tick);
            else res(g);
          };
          requestAnimationFrame(tick);
        }),
    );
    const canvas = await ready(page);
    const long = await page.evaluate(() => (window as unknown as { __long: number[] }).__long);
    const maxGap = Math.max(...gaps);
    const maxLong = Math.max(0, ...long);
    console.log(
      `300 parts: maxFrameGap=${Math.round(maxGap)}ms maxLongTask=${Math.round(maxLong)}ms`,
    );
    await expect(page.getByTestId('sim-check-status')).toHaveAttribute('data-ok', 'true');
    const steps = Number(await canvas.getAttribute('data-steps'));
    console.log(`300 parts: steps=${steps}`);
    const scrubber = page.getByTestId('sim-scrubber');
    const max = Number(await scrubber.getAttribute('max'));
    const t0 = Date.now();
    for (let i = 0; i <= 20; i += 1) await scrubber.fill(String(Math.round((max * i) / 20)));
    for (let i = 0; i < 5; i += 1) {
      await page.getByRole('button', { name: s.controls.start }).click();
      await page.getByRole('button', { name: s.controls.end }).click();
    }
    await expect(canvas).toHaveAttribute('data-done', String(steps));
    const took = Date.now() - t0;
    console.log(`300 parts: scrub total ${took}ms`);
    expect(took).toBeLessThan(5000);
    expect(maxLong).toBeLessThan(1000);
  });
});
