import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  goStep,
  openNewProject,
  openThinSkinProject,
  openWorkspacePanel,
  pasteAndNest,
} from './wizard-helpers';

// B74 tester: T425 example ACM sets on a fresh machine (filled, unverified, typing never
// confirms, saved as unverified); T428 tab extra-sheet hint (undo, no UI freeze, absent with thin
// skin, 1024 layout).

const SHOTS = '__screenshots__/b74';
const t = tr.machines;

interface ApiSet {
  material: string;
  thickness: number;
  unverified?: boolean;
  feed?: number;
  plungeFeed?: number;
  rpm?: number;
  stepDown?: number;
  tool?: number;
}

/** A copy of the seeded machine without ACM sets (never touches the shared seeded machine). */
async function freshMachine(request: APIRequestContext): Promise<string> {
  const list = (await (await request.get('/api/machines')).json()) as { id: string }[];
  const first = list[0];
  if (!first) throw new Error('no machine');
  const d = (await (await request.get(`/api/machines/${first.id}`)).json()) as {
    profile: { example?: boolean; identity: { name: string }; materials: ApiSet[] };
  };
  const p = structuredClone(d.profile);
  p.example = false;
  p.identity.name = `B74 ${Date.now() % 100000}`;
  p.materials = p.materials.filter((m) => m.material !== 'acm');
  const res = await request.post('/api/machines', { data: { profile: p } });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function acmSets(request: APIRequestContext, id: string): Promise<ApiSet[]> {
  const d = (await (await request.get(`/api/machines/${id}`)).json()) as {
    profile: { materials: ApiSet[] };
  };
  return d.profile.materials.filter((m) => m.material === 'acm');
}

async function save(page: Page) {
  await page.getByRole('button', { name: t.form.save, exact: true }).click();
  await expect(page.getByTestId('machine-dirty')).toHaveCount(0, { timeout: 30_000 });
}

test.describe('T425 tester: example ACM sets on a fresh machine', () => {
  test('filled, unverified; typing keeps the mark; only "Değerleri doğruladım" clears it', async ({
    page,
    request,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    const id = await freshMachine(request);
    await page.goto(`/makineler?duzenle=${id}&ayar=acm-4&ornek=1`);
    await expect(page.getByTestId('machine-form')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('machine-dirty')).toBeVisible();
    const table = page.getByTestId('materials-table');
    const rows = table.locator('tbody tr:not([data-detail])');
    // Every required number of every ACM row is filled.
    let acmRows = 0;
    for (const row of await rows.all()) {
      const kind = await row.locator('[id$="-material"]').textContent();
      if (!/ACM|Kompozit/i.test(kind ?? '')) continue;
      acmRows++;
      for (const k of ['feed', 'plungeFeed', 'rpm', 'stepDown', 'tool'])
        await expect(row.locator(`[id$="-${k}"]`), `${kind} ${k}`).not.toHaveValue('');
    }
    expect(acmRows).toBeGreaterThan(0);
    await expect(page.locator('#sec-materials [aria-invalid="true"]')).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/acm-examples-1440.png`, fullPage: true });

    await save(page);
    let sets = await acmSets(request, id);
    expect(sets.length).toBe(acmRows);
    for (const s of sets) {
      expect(s.unverified, `${s.thickness} mm`).toBe(true);
      for (const k of ['feed', 'plungeFeed', 'rpm', 'stepDown'] as const)
        expect(s[k], `${s.thickness} ${k}`).toBeGreaterThan(0);
    }

    // Typing a value on a saved row does not confirm it.
    await page.goto(`/makineler?duzenle=${id}`);
    await expect(page.getByTestId('machine-form')).toBeVisible({ timeout: 30_000 });
    const details = table.locator('tbody tr[data-detail]');
    const note = details.getByTestId('material-unverified-note');
    const before = await note.count();
    expect(before).toBe(acmRows);
    // The first ACM set by its index in the stored list (the form keeps that order).
    const stored = (
      (await (await request.get(`/api/machines/${id}`)).json()) as {
        profile: { materials: ApiSet[] };
      }
    ).profile.materials;
    const feed = page.locator(`#f-materials-${stored.findIndex((s) => s.material === 'acm')}-feed`);
    await feed.fill('1900');
    await feed.press('Tab');
    await expect(feed).toHaveValue(/^1\.?900$/);
    await expect(page.getByTestId('machine-dirty')).toBeVisible();
    await expect(note).toHaveCount(before);
    const v0 = ((await (await request.get(`/api/machines/${id}`)).json()) as { version: number })
      .version;
    await save(page);
    const v1 = ((await (await request.get(`/api/machines/${id}`)).json()) as { version: number })
      .version;
    expect(v1, 'the save made a new profile version').toBe(v0 + 1);
    sets = await acmSets(request, id);
    expect(sets.every((s) => s.unverified === true)).toBe(true);
    expect(sets.some((s) => s.feed === 1900)).toBe(true);

    // "Değerleri doğruladım" on one row clears only that mark.
    await page.goto(`/makineler?duzenle=${id}`);
    await expect(page.getByTestId('machine-form')).toBeVisible({ timeout: 30_000 });
    await details.getByTestId('material-unverified-confirm').first().click();
    await expect(note).toHaveCount(before - 1);
    await save(page);
    sets = await acmSets(request, id);
    expect(sets.filter((s) => s.unverified === true).length).toBe(acmRows - 1);
  });
});

const STRIPS = ['Parça adı\tEn\tBoy\tAdet\tDamar', 'Şerit\t390\t2000\t7\thayır'].join('\n');

test.describe('T428 tester: tab extra-sheet hint', () => {
  for (const w of [1440, 1024]) {
    test(`apply is undoable, the probe never blocks the page, axe clean (${w})`, async ({
      page,
    }) => {
      test.setTimeout(90_000);
      // Nest at 1440 (below xl the settings panel folds away), then look at width w.
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.addInitScript(() => {
        const longs: number[] = [];
        (window as unknown as { __longs: number[] }).__longs = longs;
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) longs.push(Math.round(e.duration));
        }).observe({ type: 'longtask', buffered: true });
      });
      await openNewProject(page, 'parcalar');
      await pasteAndNest(page, STRIPS, 1);
      const sheets = page.getByTestId('nesting-sheets');
      await expect(sheets).toHaveText('2', { timeout: 20_000 });
      await page.evaluate(() => ((window as unknown as { __longs: number[] }).__longs.length = 0));
      const hint = page.getByTestId('layout-tab-extra-sheet');
      await expect(hint).toBeVisible({ timeout: 30_000 });
      const longs = await page.evaluate(() => (window as unknown as { __longs: number[] }).__longs);
      test.info().annotations.push({ type: 'longtasks', description: longs.join(',') });
      expect(Math.max(0, ...longs), 'long task while the probe ran').toBeLessThan(200 * 3);
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(400);
      test.info().annotations.push({
        type: 'hint-visible-at-w',
        description: String(await hint.isVisible()),
      });
      if (!(await hint.isVisible())) {
        await openWorkspacePanel(page, 'left');
      }
      await expect(hint).toBeInViewport();
      await page.screenshot({ path: `${SHOTS}/hint-${w}.png` });
      const axe = await new AxeBuilder({ page })
        .include('[data-testid="layout-tab-extra-sheet"]')
        .analyze();
      expect(
        axe.violations
          .filter((v) => v.impact === 'serious' || v.impact === 'critical')
          .map((v) => v.id),
      ).toEqual([]);

      await hint.getByTestId('layout-tab-extra-sheet-apply').click();
      await expect(sheets).toHaveText('1', { timeout: 20_000 });
      await expect(hint).toHaveCount(0);

      // Undo: the first step reverts the nest only (thin skin stays on beside the tab layout);
      // the second reverts thin skin, and the hint comes back. Polish: one click, two undo steps.
      const undo = page.getByTestId('wizard-undo');
      await undo.click();
      await expect(sheets).toHaveText('2', { timeout: 10_000 });
      const pay = page.getByText(/Boşluk [0-9,]+ mm \(Ø/).first();
      test.info().annotations.push({
        type: 'after-1-undo',
        description: (await pay.textContent()) ?? '',
      });
      await undo.click();
      await expect(sheets).toHaveText('2', { timeout: 10_000 });
      await expect(hint).toBeVisible({ timeout: 30_000 });
    });
  }

  test('a thin-skin job never shows the hint', async ({ page }) => {
    await openThinSkinProject(page, 'parcalar');
    await pasteAndNest(page, STRIPS, 1);
    await expect(page.getByTestId('nesting-sheets')).toHaveText(/\d/, { timeout: 20_000 });
    await page.waitForTimeout(3000);
    await expect(page.getByTestId('layout-tab-extra-sheet')).toHaveCount(0);
  });

  test('a layout whose last sheet is well used shows no hint', async ({ page }) => {
    await openNewProject(page, 'parcalar');
    // 12 strips: two full-ish sheets with tabs, no nearly empty last sheet.
    await pasteAndNest(page, STRIPS.replace('\t7\t', '\t12\t'), 1);
    await expect(page.getByTestId('nesting-sheets')).toHaveText(/\d/, { timeout: 20_000 });
    await page.waitForTimeout(3000);
    await expect(page.getByTestId('layout-tab-extra-sheet')).toHaveCount(0);
    await goStep(page, 'parcalar');
  });
});
