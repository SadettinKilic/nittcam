import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { downloadAndVerifyNc, nestNow } from './regression-helpers';
import {
  KITCHEN,
  SEEDED,
  chooseMachine,
  goStep,
  openNewProject,
  paste,
  pickOption,
  projectId,
  saved,
  wizardReady,
} from './wizard-helpers';

/**
 * B61 tester (T327–T329, D-120): the "Kesim ayarı ekle" fix flow on the seeded example machine
 * (tools Ø6 / Ø8 two-flute) starts from the table, with the source line, the material note and
 * the tool hint, in light and dark at 1440 / 1024 (390 smoke) and axe clean; saving without
 * confirming keeps the project blocked (T265). End to end: plywood 18 on the example machine
 * exports with the table values (5000 / 1200 / 18 000 / step-down ≤ 6) in the Mach3 file.
 */

async function axeClean(page: Page) {
  const res = await new AxeBuilder({ page }).analyze();
  const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
}

async function values(row: Locator): Promise<number[]> {
  const out: number[] = [];
  for (const k of ['feed', 'plungeFeed', 'rpm', 'stepDown']) {
    const raw = await row.locator(`[id$="-${k}"]`).inputValue();
    out.push(raw === '' ? NaN : Number(raw.replace(/\./g, '').replace(',', '.')));
  }
  return out;
}

test('fix flow: acrylic 10 on the example machine starts from the table, stays blocked', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'makine');
  await chooseMachine(page, SEEDED);
  await pickOption(page.getByTestId('wizard-material'), tr.materials.acrylic);
  const thick = page.getByTestId('wizard-thickness');
  await thick.fill('10');
  await thick.press('Enter');
  await expect(page.getByTestId('no-cutting-params')).toBeVisible();
  await page.getByTestId('add-cutting-params').click();
  await expect(page.getByTestId('machine-form')).toBeVisible({ timeout: 30_000 });

  const table = page.getByTestId('materials-table');
  const row = table.locator('tbody tr:not([data-detail])').last();
  const detail = table.locator('tbody tr[data-detail]').last();
  // No single-flute on the example machine: the first tool (Ø6 two-flute) with the hint;
  // §d acrylic Ø6 z2: 4300 / 18 000 / 3; plunge 0,25 × feed = 1000 (PO B61 decision).
  expect(await values(row)).toEqual([4300, 1000, 18000, 3]);
  expect(await row.locator('[id$="-tool"]').inputValue()).toBe('1');
  const source = detail.getByTestId('material-starting-source');
  await expect(source).toHaveAttribute('data-kind', 'table');
  await expect(source).toContainText('Başlangıç değeri:');
  await expect(source).toContainText('doğrulanmadı, önce deneme kesimi');
  await expect(detail.getByTestId('material-starting-note')).toHaveText(
    tr.machines.form.startingNotes.acrylicPlastic,
  );
  await expect(detail.getByTestId('material-tool-hint')).toHaveText(
    tr.machines.form.toolFit.plasticSingleFlute,
  );
  await expect(detail.getByTestId('material-unverified-confirm')).toBeVisible();

  // Tool 2 (Ø8 z2) before any edit refreshes: 5000 / 1200 / 18 000 / 4 (PO B61 plunge).
  const tool = row.locator('[id$="-tool"]');
  await tool.fill('2');
  await tool.press('Tab');
  expect(await values(row)).toEqual([5000, 1200, 18000, 4]);
  // Thickness 3 → the step-down never exceeds the sheet.
  const t = row.locator('[id$="-thickness"]');
  await t.fill('3');
  await t.press('Tab');
  expect(await values(row)).toEqual([5000, 1200, 18000, 3]);
  await t.fill('10');
  await t.press('Tab');
  expect(await values(row)).toEqual([5000, 1200, 18000, 4]);

  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const [w, h] of [
      [1440, 900],
      [1024, 768],
      [390, 844],
    ] as const) {
      await page.setViewportSize({ width: w, height: h });
      await detail.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `__screenshots__/b61-fix-row-${w}-${scheme}.png` });
      if (w === 390) {
        const extra = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(extra).toBeLessThanOrEqual(1);
      }
      await page.waitForTimeout(300);
      await axeClean(page);
    }
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1440, height: 900 });

  // Saved without confirming: still unverified, the project stays blocked (T265).
  const save = page.getByRole('button', { name: tr.machines.form.save, exact: true });
  await save.click();
  const done = page.getByTestId('param-fix-saved');
  await expect(done).toBeVisible({ timeout: 30_000 });
  await done.getByTestId('param-fix-return').click();
  await wizardReady(page, 'makine');
  await expect(page.getByTestId('no-cutting-params')).toBeVisible();
  await expect(page.getByTestId('cutting-params')).toHaveCount(0);
});

test('machine form "Ekle": melamine on Ø6 / Ø8 two-flute tools; plywood; solid wood; PVC', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/makineler');
  await page.getByRole('button', { name: tr.machines.add }).click();
  await expect(page.getByTestId('machine-form')).toBeVisible({ timeout: 30_000 });
  const table = page.getByTestId('materials-table');
  await page.locator('#sec-materials').getByRole('button', { name: tr.machines.form.add }).click();
  const row = table.locator('tbody tr:not([data-detail])').last();
  const detail = table.locator('tbody tr[data-detail]').last();
  const tool = row.locator('[id$="-tool"]');
  const kind = row.locator('[id$="-material"]');

  const cases: [string, string, number[]][] = [
    [tr.machines.form.options.material.plywood, '1', [4700, 1100, 18000, 6]],
    [tr.machines.form.options.material.plywood, '2', [5000, 1200, 18000, 6]],
    [tr.machines.form.options.material.solidWood, '2', [4300, 1000, 18000, 4]],
    [tr.machines.form.options.material.solidWood, '1', [3600, 900, 18000, 3]],
    // PO B61 decision: plastics plunge 0,25 × feed.
    [tr.machines.form.options.material.pvc, '1', [4300, 1000, 18000, 3]],
    [tr.machines.form.options.material.pvc, '2', [5000, 1200, 18000, 4]],
    [tr.machines.form.options.material.mdf, '2', [6000, 1500, 18000, 6]],
    [tr.machines.form.options.material.mdf, '1', [5400, 1300, 18000, 6]],
  ];
  for (const [k, n, expected] of cases) {
    await pickOption(kind, k);
    await tool.fill(n);
    await tool.press('Tab');
    expect(await values(row), `${k} T${n}`).toEqual(expected);
    await expect(detail.getByTestId('material-starting-source')).toHaveAttribute(
      'data-kind',
      'table',
    );
  }
  // Melamine: Ø8 two-flute has the "no compression" row with its note and the hint …
  await pickOption(kind, tr.machines.form.options.material.melamine);
  await tool.fill('2');
  await tool.press('Tab');
  expect(await values(row)).toEqual([5000, 1200, 18000, 6]);
  await expect(detail.getByTestId('material-starting-note')).toHaveText(
    tr.machines.form.startingNotes.melamineNoCompression,
  );
  await expect(detail.getByTestId('material-tool-hint')).toHaveText(
    tr.machines.form.toolFit.melamineCompression,
  );
  // … the Ø6 two-flute has none: empty fields, never a guess.
  await tool.fill('1');
  await tool.press('Tab');
  expect((await values(row)).every((x) => Number.isNaN(x))).toBe(true);
  await expect(detail.getByTestId('material-starting-source')).toHaveAttribute('data-kind', 'none');
  await expect(detail).toContainText('Bu malzeme için hazır değer yok');
  // Back to a table row after "none": filled again (still untouched).
  await pickOption(kind, tr.machines.form.options.material.mdf);
  expect(await values(row)).toEqual([5400, 1300, 18000, 6]);
});

test('end to end: plywood 18 on the example machine → Mach3 NC carries the table values', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'makine');
  await chooseMachine(page, SEEDED);
  await pickOption(page.getByTestId('wizard-material'), tr.materials.plywood);
  await expect(page.getByTestId('cutting-params')).toBeVisible({ timeout: 15_000 });
  await goStep(page, 'parcalar');
  await paste(page, KITCHEN, 5);
  await goStep(page, 'dizilim');
  const sheets = await nestNow(page);
  await saved(page);
  const id = await projectId(page);
  const { files } = await downloadAndVerifyNc(page, id, sheets);
  for (const f of files) {
    const lines = f.content.split('\n');
    expect(lines[0]).toContain('DOGRULANMADI, once air cut');
    expect(f.content).toContain('(MALZEME: plywood 18.000 mm');
    expect(f.content).toContain('M3 S18000');
    expect(f.content).not.toMatch(/\bS(?!18000\b)\d+/);
    // Cut feed 5000, plunge 1200: no other F word in the file.
    const feeds = [...new Set([...f.content.matchAll(/F(\d+(?:\.\d+)?)/g)].map((m) => m[1]))];
    expect(feeds.sort()).toEqual(['1200', '5000']);
    // Every plunge (G1 Z… F1200) goes at most 6 mm deeper than the level before it.
    let z = 0;
    for (const l of lines) {
      const m = /^G1 Z(-?\d+\.\d+)/.exec(l);
      if (m) {
        const nz = Number(m[1]);
        if (nz < z) expect(z - nz, l).toBeLessThanOrEqual(6 + 1e-6);
        z = nz;
      } else if (/^G0 Z/.test(l)) z = 0;
    }
  }
});
