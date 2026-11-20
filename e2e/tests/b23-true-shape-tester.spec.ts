import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { goStep, KITCHEN, openNewProject, paste, watchConsole } from './wizard-helpers';

/** B23 tester (T166/T167): Dizilim options 45° / 15° / part-in-hole at 1440 + axe, 390 smoke. */
const w = tr.wizard.layout;

async function axeClean(page: Page) {
  const res = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
}

async function open(page: Page, phone = false) {
  await openNewProject(page, 'parcalar');
  await paste(page, KITCHEN, 5);
  await goStep(page, 'dizilim');
  if (phone) {
    // phone: the options live in the "Ayarlar" drawer next to the canvas
    await expect(page.getByRole('tab', { name: /Plaka 1/ })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'Ayarlar', exact: true }).click();
  } else await expect(page.getByTestId('nesting-sheets')).toBeVisible({ timeout: 20_000 });
}

test.describe('B23 Dizilim options', () => {
  test('1440: 45° / 15° radios, part-in-hole off by default, keyboard, axe, re-nest', async ({
    page,
  }) => {
    const problems = watchConsole(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page);
    const rotation = page.getByTestId('layout-rotation');
    const inHole = page.getByTestId('layout-part-in-hole');
    await expect(inHole).toHaveAttribute('data-state', 'unchecked');
    await expect(page.getByText(w.rotations.step45, { exact: true }).first()).toBeVisible();
    await page.getByRole('radio', { name: w.rotations.step15, exact: true }).click();
    await expect(rotation).toHaveAttribute('data-value', 'step15');
    // keyboard: the switch toggles with Space
    await inHole.focus();
    await page.keyboard.press('Space');
    await expect(inHole).toHaveAttribute('data-state', 'checked');
    await page.keyboard.press('Space');
    await expect(inHole).toHaveAttribute('data-state', 'unchecked');
    await inHole.click();
    await page.getByRole('button', { name: tr.cutList.nesting.run, exact: true }).click();
    await expect(page.getByTestId('nesting-sheets')).toBeVisible({ timeout: 30_000 });
    await axeClean(page);
    expect(problems).toEqual([]);
  });

  test('390: no page-level horizontal scroll, options reachable, axe clean', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, true);
    await expect(page.getByTestId('layout-rotation')).toBeVisible();
    await page.getByTestId('layout-part-in-hole').scrollIntoViewIfNeeded();
    await expect(page.getByTestId('layout-part-in-hole')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await axeClean(page);
  });
});
