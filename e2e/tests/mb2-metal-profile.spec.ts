import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };

// MB2 (T344, T345): V-bit angle and flat tip in the tool table (optional), and the "Metal kesim"
// section: coolant, metal declaration; the example profile's vacuum M7 refuses coolant M8/M9
// with the fix text, and without coolant the profile saves as today.
const t = tr.machines;
const f = t.form.fields;
const o = t.form.options;

async function openNew(page: Page, name: string) {
  await page.goto('/makineler');
  await page.getByRole('button', { name: t.add }).click();
  await expect(page.getByRole('heading', { name: t.form.createTitle })).toBeVisible();
  await page.getByLabel(f.name).fill(name);
}

async function choose(page: Page, label: string, option: string, nth = 0) {
  await page.getByRole('combobox', { name: label }).nth(nth).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

const save = (page: Page) => page.getByRole('button', { name: t.form.save, exact: true }).click();
const saved = (page: Page, v: number) =>
  expect(page.getByText(t.form.saved.replace('{version}', String(v)))).toBeVisible();

test('T345: example vacuum M7 + coolant M8/M9 is refused with the fix text; no coolant saves', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNew(page, `MB2 soğutma ${Date.now()}`);
  const section = page.locator('[data-section="metal"]');
  await expect(section.getByRole('heading', { name: t.form.sections.metal })).toBeVisible();
  // declaration off by default; rigidity appears only once on
  await expect(section.getByRole('checkbox', { name: f.metalEnabled })).not.toBeChecked();
  await expect(section.getByRole('combobox', { name: f.rigidity })).toHaveCount(0);
  await section.getByRole('checkbox', { name: f.metalEnabled }).check();
  await expect(section.getByRole('combobox', { name: f.rigidity })).toBeVisible();

  await choose(page, f.coolantType, o.coolantType.flood);
  await expect(section.getByLabel(f.coolantOn)).toHaveValue('M8');
  await expect(section.getByLabel(f.coolantOff)).toHaveValue('M9');
  await save(page);
  await expect(page.getByText(t.errors.vacuumUsesCoolantCode).first()).toBeVisible();
  await expect(section.getByText(t.errors.mCodeConflict)).toBeVisible();

  // the fix: the vacuum on its own outputs
  await page.getByLabel(f.vacuumOn).fill('M10');
  await page.getByLabel(f.vacuumOff).fill('M11');
  await save(page);
  await saved(page, 1);
});

test('T345: without coolant the new profile saves as today', async ({ page }) => {
  await openNew(page, `MB2 düz ${Date.now()}`);
  await save(page);
  await saved(page, 1);
});

test('T344: a V-bit saves without angle; the angle and tip fields show only for a V-bit', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const name = `MB2 V uç ${Date.now()}`;
  await openNew(page, name);
  await expect(page.getByTestId('tool-vbit-0')).toHaveCount(0);
  await choose(page, f.toolType, o.toolType.vBit, 0);
  const vbit = page.getByTestId('tool-vbit-0');
  await expect(vbit.getByLabel(f.vBitAngle)).toHaveValue('');
  await expect(vbit.getByLabel(f.vBitTip)).toHaveValue('');
  // a tip as wide as the bit is refused
  await vbit.getByLabel(f.vBitTip).fill('6'); // the first tool is Ø6
  await save(page);
  await expect(vbit.getByText(t.errors.tipNotBelowDiameter)).toBeVisible();
  // empty again: a V-bit without angle or tip saves
  await vbit.getByLabel(f.vBitTip).fill('');
  await save(page);
  await saved(page, 1);

  const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name, exact: false }) });
  await row.getByRole('button', { name: `${t.edit}: ${name}` }).click();
  const again = page.getByTestId('tool-vbit-0');
  await again.getByLabel(f.vBitAngle).fill('90');
  await again.getByLabel(f.vBitTip).fill('0,2');
  await save(page);
  await saved(page, 2);
});
