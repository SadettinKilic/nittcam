import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };

// MB2 tester: "Metal kesim" card at 1440 and 390 (no page scroll, axe), V-bit angle range 10–179.
const t = tr.machines;
const f = t.form.fields;
const o = t.form.options;

async function openNew(page: import('@playwright/test').Page) {
  await page.goto('/makineler');
  await page.getByRole('button', { name: t.add }).click();
  await expect(page.getByRole('heading', { name: t.form.createTitle })).toBeVisible();
  await page.getByLabel(f.name).fill(`MB2 T ${Date.now()}`);
}

for (const [w, h] of [
  [1440, 900],
  [390, 844],
] as const) {
  test(`MB2: Metal kesim card ${w}px: no page scroll, axe clean`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await openNew(page);
    const section = page.locator('[data-section="metal"]');
    await section.scrollIntoViewIfNeeded();
    await expect(section.getByRole('heading', { name: t.form.sections.metal })).toBeVisible();
    await section.getByRole('checkbox', { name: f.metalEnabled }).check();
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(over).toBeLessThanOrEqual(0);
    await page.waitForTimeout(500);
    const res = await new AxeBuilder({ page }).analyze();
    const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
    expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
  });
}

test('MB2: V-bit angle outside 10–179 is refused, 9 and 180 alike', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNew(page);
  await page.getByRole('combobox', { name: f.toolType }).first().click();
  await page.getByRole('option', { name: o.toolType.vBit, exact: true }).click();
  const vbit = page.getByTestId('tool-vbit-0');
  for (const bad of ['9', '180']) {
    await vbit.getByLabel(f.vBitAngle).fill(bad);
    await page.getByRole('button', { name: t.form.save, exact: true }).click();
    await expect(page.getByText(t.form.saved.replace('{version}', '1'))).toHaveCount(0);
  }
  await vbit.getByLabel(f.vBitAngle).fill('179');
  await page.getByRole('button', { name: t.form.save, exact: true }).click();
  await expect(page.getByText(t.form.saved.replace('{version}', '1'))).toBeVisible();
});
