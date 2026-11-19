import { writeFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { openNewProject, paste } from './wizard-helpers';

/**
 * T137 performance budget of the drawing board (spec §11): with 500 parts on the board, pan and
 * zoom keep ≥ 50 frames per second and a click selects in < 50 ms. The numbers and a Chromium
 * performance trace are attached to the test (test-results/, the Playwright report).
 */

const PARTS = 500;
const FPS_MIN = 50;
const SELECT_MS_MAX = 50;

/** 500 different small parts (10 sizes × 50 names), one each. */
function bigList(): string {
  const rows = ['Ad\tEn\tBoy\tAdet'];
  for (let i = 0; i < PARTS; i++)
    rows.push(`P${i + 1}\t${100 + (i % 10) * 20}\t${80 + (i % 7) * 15}\t1`);
  return rows.join('\n');
}

/** Frames per second while `act` runs, counted with requestAnimationFrame in the page. */
async function fpsDuring(page: Page, act: () => Promise<void>): Promise<number> {
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number; __run: boolean; __t0: number };
    w.__frames = 0;
    w.__run = true;
    w.__t0 = performance.now();
    const tick = () => {
      if (!w.__run) return;
      w.__frames += 1;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await act();
  return page.evaluate(() => {
    const w = window as unknown as { __frames: number; __run: boolean; __t0: number };
    w.__run = false;
    return (w.__frames * 1000) / (performance.now() - w.__t0);
  });
}

/**
 * Time from the pointer release (the board selects on release) to the frame after the canvas's
 * selection changed (ms), measured in the page; the press-to-release gap is the test driver's, not
 * the board's. `null` when the click selected nothing new.
 */
async function selectLatency(page: Page, canvas: Locator, x: number, y: number) {
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="editor-canvas"]') as HTMLElement;
    const w = window as unknown as { __sel: Promise<number | null> };
    const before = el.dataset.selection ?? '';
    w.__sel = new Promise((resolve) => {
      let t0 = 0;
      el.addEventListener('pointerup', () => (t0 = performance.now()), {
        capture: true,
        once: true,
      });
      const mo = new MutationObserver(() => {
        if ((el.dataset.selection ?? '') === before) return;
        mo.disconnect();
        requestAnimationFrame(() => resolve(performance.now() - t0));
      });
      mo.observe(el, { attributes: true, attributeFilter: ['data-selection'] });
      setTimeout(() => {
        mo.disconnect();
        resolve(null);
      }, 1000);
    });
  });
  await canvas.click({ position: { x, y } });
  return page.evaluate(() => (window as unknown as { __sel: Promise<number | null> }).__sel);
}

test.describe('T137 drawing board performance budget', () => {
  test(`${PARTS} parts: pan/zoom ≥ ${FPS_MIN} fps, selection < ${SELECT_MS_MAX} ms`, async ({
    page,
    browser,
  }, info) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'parcalar');
    await paste(page, bigList(), PARTS);
    await page.getByTestId('parts-view-drawing').click();
    const canvas = page.getByTestId('editor-canvas');
    await expect(canvas).toHaveAttribute('aria-label', new RegExp(`${PARTS} parça`));
    await expect(canvas).toHaveAttribute('data-view', /\d/);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('no canvas');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await canvas.focus();
    await page.keyboard.press('f');

    const tracePath = info.outputPath('editor-perf-trace.json');
    await browser.startTracing(page, { path: tracePath, screenshots: false });

    // Pan: drag with the pan tool across the board and back.
    await page.keyboard.press('h');
    const panFps = await fpsDuring(page, async () => {
      for (let round = 0; round < 3; round++) {
        await page.mouse.move(cx - 200, cy);
        await page.mouse.down();
        await page.mouse.move(cx + 200, cy + 80, { steps: 40 });
        await page.mouse.up();
      }
    });

    // Zoom: wheel in and out around the centre.
    const zoomFps = await fpsDuring(page, async () => {
      await page.mouse.move(cx, cy);
      for (let i = 0; i < 20; i++) await page.mouse.wheel(0, i < 10 ? -120 : 120);
    });

    // Selection: clicks on a grid over the board with the select tool; a hit must be among them.
    await page.keyboard.press('v');
    await page.keyboard.press('f');
    const latencies: number[] = [];
    for (let gx = 1; gx <= 5 && latencies.length < 5; gx++) {
      for (let gy = 1; gy <= 4 && latencies.length < 5; gy++) {
        const ms = await selectLatency(page, canvas, (box.width * gx) / 6, (box.height * gy) / 5);
        if (ms !== null) latencies.push(ms);
        await page.keyboard.press('Escape');
      }
    }
    await browser.stopTracing();

    const selectMs = latencies.length > 0 ? Math.max(...latencies) : Infinity;
    const result = { parts: PARTS, panFps, zoomFps, selectMs, latencies };
    const summary = info.outputPath('editor-perf.json');
    await writeFile(summary, JSON.stringify(result, null, 2));
    await info.attach('editor-perf', { path: summary, contentType: 'application/json' });
    await info.attach('editor-perf-trace', { path: tracePath, contentType: 'application/json' });
    console.log(`T137 perf: ${JSON.stringify(result)}`);

    expect(latencies.length, 'at least one click selected a part').toBeGreaterThan(0);
    expect(panFps).toBeGreaterThanOrEqual(FPS_MIN);
    expect(zoomFps).toBeGreaterThanOrEqual(FPS_MIN);
    expect(selectMs).toBeLessThan(SELECT_MS_MAX);
  });
});
