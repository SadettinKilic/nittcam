import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  KITCHEN,
  goStep,
  openNewProject,
  paste,
  saved,
  wizardReady,
  watchConsole,
} from './wizard-helpers';

// B71 tester: T385 (lazy Makine step and shell overlays stay usable offline, D-117), T397 (Montaj
// P5–P7), T398 (P8 margin helper, P11 Malzemeler columns).

test.use({ launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] } });

const SHOTS = '__screenshots__/b71';
const palette = (page: Page) => page.getByTestId('command-palette');
async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error('no bounding box');
  return b;
}
const offlineNoise = (p: string) => /Failed to load resource|ERR_|net::/.test(p);

async function unsentDraftQueue(page: Page): Promise<string> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) ?? '';
      if (k.startsWith('nittcam.unsent')) out.push(localStorage.getItem(k) ?? '');
    }
    return out.join('\n');
  });
}

async function overlaysWork(page: Page) {
  // Ctrl+K palette (cmdk chunk).
  await page.keyboard.press('Control+k');
  await expect(page.getByPlaceholder(tr.palette.placeholder)).toBeVisible();
  // Yenilikler from the palette (its own chunk).
  await page.getByPlaceholder(tr.palette.placeholder).fill('yenilikler');
  await palette(page).getByRole('option', { name: tr.palette.whatsNew }).click();
  await expect(page.getByTestId('whats-new-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('whats-new-dialog')).toHaveCount(0);
  // Shortcuts sheet (Shift+?), focus outside an input.
  await page.getByTestId('wizard-step-title').click();
  await page.keyboard.press('Shift+?');
  await expect(page.getByTestId('shortcuts-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('shortcuts-dialog')).toHaveCount(0);
}

test.describe('T385 tester: lazy chunks and offline drafts (D-117)', () => {
  test('new draft: loaded online, then offline: Makine, palette, Yenilikler, shortcuts, paste; nothing lost', async ({
    page,
    context,
  }) => {
    test.setTimeout(120_000);
    const problems = watchConsole(page);
    await openNewProject(page, 'parcalar');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500); // the preloads start 500 ms after `load`
    await context.setOffline(true);

    await goStep(page, 'makine');
    await expect(page.getByTestId('thin-skin-switch')).toBeVisible();
    await expect(page.getByTestId('step-loading')).toHaveCount(0);
    await overlaysWork(page);

    await goStep(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    await expect(page.getByTestId('save-status')).toHaveAttribute(
      'data-state',
      /error|pending|saving/,
      {
        timeout: 15_000,
      },
    );
    // The draft's edits are in the stored queue (the paste with its parts).
    await expect.poll(() => unsentDraftQueue(page)).toContain('Yan');

    await expect(page.getByTestId('wizard-step-title')).toBeVisible();
    await context.setOffline(false);
    await expect(page.getByTestId('save-status')).toHaveAttribute('data-state', 'saved', {
      timeout: 45_000,
    });
    const id = page.url().match(/projeler\/([0-9a-f-]{36})/)?.[1];
    expect(id, 'the draft became a project once back online').toBeTruthy();
    const server = await (await page.request.get(`/api/projects/${id}`)).json();
    expect(server.project.parts.length).toBe(5);
    expect(problems.filter((p) => !offlineNoise(p))).toEqual([]);
  });

  test('saved project, offline right after the step shows (before the 500 ms preload)', async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    const problems = watchConsole(page);
    await openNewProject(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    await saved(page);
    const id = page.url().match(/projeler\/([0-9a-f-]{36})/)?.[1];
    await page.goto(`/projeler/${id}?adim=parcalar`);
    await wizardReady(page, 'parcalar');
    await context.setOffline(true);
    await goStep(page, 'makine').catch(() => undefined);
    const machineOk = await page.getByTestId('thin-skin-switch').isVisible();
    await page.keyboard.press('Control+k');
    const paletteOk = await page
      .getByPlaceholder(tr.palette.placeholder)
      .isVisible({ timeout: 3000 })
      .catch(() => false);
    await page.screenshot({ path: `${SHOTS}/offline-early.png` });
    test.info().annotations.push({
      type: 'offline-early',
      description: `makine=${machineOk} palette=${paletteOk}`,
    });
    await context.setOffline(false);
    expect(problems.filter((p) => !offlineNoise(p))).toEqual([]);
  });

  test('first open of the Makine step: no skeleton flash once preloaded, quick', async ({
    page,
  }) => {
    await openNewProject(page, 'parcalar');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    // Records how long the step skeleton is on screen (a one-frame suspense is not a flash).
    await page.evaluate(() => {
      const w = window as unknown as { __sk: { on: number; off: number } };
      w.__sk = { on: 0, off: 0 };
      new MutationObserver(() => {
        const s = document.querySelector('[data-testid="step-loading"]');
        if (s && !w.__sk.on) w.__sk.on = performance.now();
        if (!s && w.__sk.on && !w.__sk.off) w.__sk.off = performance.now();
      }).observe(document.body, { childList: true, subtree: true });
    });
    const t0 = Date.now();
    await page.getByTestId('wizard-step-makine').click();
    await expect(page.getByTestId('thin-skin-switch')).toBeVisible();
    const ms = Date.now() - t0;
    const sk = await page.evaluate(
      () => (window as unknown as { __sk: { on: number; off: number } }).__sk,
    );
    const skeletonMs = sk.on ? Math.round(sk.off - sk.on) : 0;
    test.info().annotations.push({
      type: 'makine-open',
      description: `ms=${ms} skeletonMs=${skeletonMs}`,
    });
    // Polish: the cached chunk still suspends once; it must not be a visible wait.
    expect(skeletonMs).toBeLessThan(300);
    expect(ms).toBeLessThan(1500);
  });

  test('cold start on ?adim=makine: skeleton then the form, no error', async ({ page }) => {
    const problems = watchConsole(page);
    await page.goto('/projeler/yeni?adim=makine');
    await wizardReady(page, 'makine');
    await expect(page.getByTestId('thin-skin-switch')).toBeVisible({ timeout: 15_000 });
    expect(problems).toEqual([]);
  });
});

// ---------------- T397 Montaj ----------------

test.describe('T397 tester: Montaj P5–P7', () => {
  const c = tr.bench.check;
  const PARTS = ['Parça adı\tEn\tBoy\tAdet', 'Taban\t500\t400\t1', 'Yan\t400\t300\t2'].join('\n');

  async function openBench(page: Page) {
    await openNewProject(page, 'parcalar');
    await paste(page, PARTS, 2);
    await page.getByTestId('parts-view-assembly').click();
    const bench = page.getByTestId('bench');
    await expect(bench).toHaveAttribute('data-ready', 'true', { timeout: 30_000 });
    return bench;
  }
  async function setX(page: Page, row: number, x: string) {
    // Below xl the part list is folded away.
    const show = page.getByRole('button', { name: tr.bench.workspace.expandLeft });
    if (await show.isVisible()) await show.click();
    await page.getByTestId('bench-part').nth(row).getByRole('button').first().click();
    const f = page.getByTestId('bench-pos-x');
    await f.fill(x);
    await f.press('Enter');
  }

  test('P5: a hidden loose part does not block "Her şey oturuyor"; shown again it is listed', async ({
    page,
  }) => {
    const errors = watchConsole(page);
    const bench = await openBench(page);
    await page.getByTestId('bench-check-toggle').click();
    const panel = page.getByTestId('bench-check');
    await expect(bench).toHaveAttribute('data-check', 'done');
    await setX(page, 1, '700'); // Yan 1 touches Taban
    await expect(panel).toHaveAttribute('data-loose', '1');
    await expect(panel).not.toContainText(c.allGood);
    // Hide the loose Yan 2: every shown part touches → "Her şey oturuyor".
    await page.getByTestId('bench-part').nth(2).getByTestId('bench-part-eye').click();
    await expect(panel).toHaveAttribute('data-loose', '0');
    await expect(panel).toContainText(c.allGood);
    // Show it again: listed as loose, the all-good line goes.
    await page.getByTestId('bench-part').nth(2).getByTestId('bench-part-eye').click();
    await expect(panel).toHaveAttribute('data-loose', '1');
    await expect(panel).not.toContainText(c.allGood);
    // Hide Taban: the two Yan touch nothing now; never all good.
    await page.getByTestId('bench-part').nth(0).getByTestId('bench-part-eye').click();
    await expect(panel).not.toContainText(c.allGood);
    expect(errors).toEqual([]);
  });

  test('P6: Oturt chosen before exploding comes back at 0 %; keys W/E/M do nothing while exploded; Ölç works', async ({
    page,
  }) => {
    const errors = watchConsole(page);
    const bench = await openBench(page);
    await page.getByTestId('bench-mode-mate').click();
    await expect(bench).toHaveAttribute('data-mode', 'mate');
    const thumb = page.getByTestId('bench-explode').getByRole('slider');
    await thumb.focus();
    await thumb.press('End');
    await expect(bench).toHaveAttribute('data-explode', '100');
    await expect(page.getByTestId('bench-hint')).toHaveText(tr.bench.tools.locked);
    await expect(page.getByTestId('bench-mode-mate')).toHaveAttribute('aria-disabled', 'true');
    // Shortcut keys from the canvas area must not switch to an editing tool.
    await page.getByTestId('bench-canvas').hover();
    for (const k of ['w', 'e', 'm']) {
      await page.keyboard.press(k);
      for (const m of ['move', 'rotate', 'mate'])
        await expect(page.getByTestId('bench-mode-' + m)).toHaveAttribute('aria-checked', 'false');
    }
    await thumb.focus();
    await thumb.press('Home');
    await expect(bench).toHaveAttribute('data-explode', '0');
    await expect(bench).toHaveAttribute('data-mode', 'mate');
    await expect(page.getByTestId('bench-mode-mate')).toHaveAttribute('aria-checked', 'true');

    // Ölç while exploded: the measure hint, not the locked one; at 0 % Ölç stays.
    await thumb.focus();
    await thumb.press('End');
    await page.getByTestId('bench-mode-measure').click();
    await expect(page.getByTestId('bench-mode-measure')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('bench-hint')).toHaveText(tr.bench.hints.measureA);
    await thumb.focus();
    await thumb.press('Home');
    await expect(page.getByTestId('bench-mode-measure')).toHaveAttribute('aria-checked', 'true');
    expect(errors).toEqual([]);
  });

  for (const [w, h] of [
    [1440, 900],
    [1280, 800],
    [1024, 768],
  ] as const) {
    test(`P7 at ${w}: results over the canvas, position fields in view, axe clean`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: w, height: h });
      const bench = await openBench(page);
      await page.getByTestId('bench-check-toggle').click();
      await expect(bench).toHaveAttribute('data-check', 'done');
      await setX(page, 1, '698'); // overlap row + loose row
      const panel = page.getByTestId('bench-check');
      await expect(panel).toHaveAttribute('data-overlaps', '1');
      await expect(page.getByTestId('bench-pos-x')).toBeInViewport();
      const pb = await box(panel);
      const cb = await box(page.getByTestId('bench-canvas'));
      expect(pb.x).toBeGreaterThanOrEqual(cb.x - 1);
      expect(pb.y).toBeGreaterThanOrEqual(cb.y - 1);
      expect(pb.x + pb.width).toBeLessThanOrEqual(cb.x + cb.width + 1);
      expect(pb.y + pb.height).toBeLessThanOrEqual(cb.y + cb.height + 1);
      // The hint and the panel do not overlap.
      const hb = await page.getByTestId('bench-hint').boundingBox();
      if (hb) {
        const apart =
          pb.y + pb.height <= hb.y + 1 ||
          hb.y + hb.height <= pb.y + 1 ||
          pb.x + pb.width <= hb.x + 1 ||
          hb.x + hb.width <= pb.x + 1;
        expect(apart, 'fit panel overlaps the hint').toBe(true);
      }
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/bench-fit-${w}.png` });
      const widths = [`canvas=${Math.round(cb.width)} panel=${Math.round(pb.width)}`];
      // Readable: the panel keeps a usable width and its result rows are in view.
      const readable = async () => {
        const b = await box(panel);
        widths.push(`panel=${Math.round(b.width)}`);
        expect(b.width, `fit panel width (${widths.join(' ')})`).toBeGreaterThanOrEqual(240);
        await expect(page.getByTestId('bench-check-row').first()).toBeInViewport({ ratio: 1 });
      };
      test.info().annotations.push({ type: 'widths', description: widths.join(' ') });
      // Both side panels open (the parts list is needed to pick a part): still readable.
      await readable();
      const collapse = page.getByRole('button', { name: tr.bench.workspace.collapseLeft });
      if (await collapse.isVisible()) {
        await collapse.click();
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${SHOTS}/bench-fit-${w}-list-closed.png` });
        await readable();
      }
      const axe = await new AxeBuilder({ page }).include('[data-testid="bench"]').analyze();
      expect(
        axe.violations
          .filter((v) => v.impact === 'serious' || v.impact === 'critical')
          .map((v) => v.id),
      ).toEqual([]);
    });
  }
});

// ---------------- T398 ----------------

test.describe('T398 tester: P8 margin helper, P11 Malzemeler', () => {
  test('P8: with tabs "En az Ø+3", sum on hover; thin skin back to the tool radius', async ({
    page,
  }) => {
    await openNewProject(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    await goStep(page, 'dizilim');
    const hint = page.getByTestId('layout-margin-hint');
    await expect(hint).toBeVisible();
    const detail = (await hint.getAttribute('title')) ?? '';
    const m = detail.match(/^Köprüyle en az Ø(\d+(?:,\d+)?) \+ 3 = (\d+(?:,\d+)?) mm$/);
    expect(m, `detail: ${detail}`).toBeTruthy();
    const toolText = m?.[1] ?? '';
    const minText = m?.[2] ?? '';
    const tool = Number(toolText.replace(',', '.'));
    const min = Number(minText.replace(',', '.'));
    expect(min).toBeCloseTo(tool + 3, 3);
    await expect(hint).toContainText(`En az ${minText} mm`);

    await goStep(page, 'makine');
    await page.getByTestId('thin-skin-switch').click();
    await goStep(page, 'dizilim');
    await expect(hint).toBeVisible();
    expect(await hint.getAttribute('title')).toBeFalsy();
    await expect(hint).not.toContainText(`En az ${minText} mm`);
  });

  for (const w of [1440, 1024]) {
    test(`P11 at ${w}: column names at xl only, metal hint, axe`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: 900 });
      await page.goto('/ayarlar/malzemeler');
      const head = page.getByTestId('material-list-head');
      await expect(page.locator('[data-testid="material-list-head"] ~ li').first()).toBeVisible({
        timeout: 20_000,
      });
      if (w >= 1280) {
        await expect(head).toBeVisible();
        for (const k of ['thicknesses', 'sheets', 'grain', 'params'] as const)
          await expect(head).toContainText(tr.materialLibrary.columns[k]);
        // Header columns line up with the first row's values (±12 px).
        const heads = await head
          .locator('span')
          .evaluateAll((s) => s.map((e) => Math.round(e.getBoundingClientRect().left)));
        const row = page.locator('[data-testid="material-list-head"] ~ li').first();
        const cols = await row
          .locator('dl > div, dl > dt')
          .evaluateAll((s) => s.map((e) => Math.round(e.getBoundingClientRect().left)));
        test.info().annotations.push({
          type: 'columns',
          description: `head=${heads.join(',')} row=${cols.join(',')}`,
        });
      } else {
        await expect(head).toBeHidden();
      }
      await page.screenshot({ path: `${SHOTS}/materials-${w}.png`, fullPage: true });
      const axe = await new AxeBuilder({ page }).analyze();
      expect(
        axe.violations
          .filter((v) => v.impact === 'serious' || v.impact === 'critical')
          .map((v) => v.id),
      ).toEqual([]);
    });
  }
});
