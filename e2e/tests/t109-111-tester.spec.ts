import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { KITCHEN, STEP_KEYS, goStep, openNewProject, paste } from './wizard-helpers';

// B4 tester (T109–T111): PO findings, keyboard-only wizard, Projeler states.

test('keyboard only: İleri/Geri with Enter walks all 5 steps and back', async ({ page }) => {
  await openNewProject(page, 'makine');
  await goStep(page, 'parcalar');
  await paste(page, KITCHEN, 5);
  const next = page.getByTestId('wizard-next');
  const title = page.getByTestId('wizard-step-title');
  await next.focus();
  await expect(next).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(title).toHaveAttribute('data-step', 'dizilim');
  await page
    .locator(
      'button[data-testid^="layout-mode-"][aria-pressed="true"]:visible, [data-testid="layout-nest-compact"]:visible',
    )
    .focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(title).toHaveAttribute('data-step', 'simulasyon');
  await expect(page.getByTestId('sim-canvas')).toBeVisible({ timeout: 30_000 });
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(title).toHaveAttribute('data-step', 'export');
  const back = page.getByTestId('wizard-back');
  await back.focus();
  await page.keyboard.press('Space');
  await expect(title).toHaveAttribute('data-step', 'simulasyon');
});

test('browser Back/Forward walks the steps (D-030)', async ({ page }) => {
  await openNewProject(page, 'makine');
  await goStep(page, 'parcalar');
  await page.goBack();
  await expect(page.getByTestId('wizard-step-title')).toHaveAttribute('data-step', 'makine');
  await page.goForward();
  await expect(page.getByTestId('wizard-step-title')).toHaveAttribute('data-step', 'parcalar');
});

test('Projeler empty state at 390 px: no h-scroll, axe clean', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/projects', (r) =>
    r.request().method() === 'GET' ? r.fulfill({ json: [] }) : r.continue(),
  );
  await page.goto('/projeler');
  await expect(page.getByTestId('projects-empty')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const res = await new AxeBuilder({ page }).analyze();
  expect(res.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))).toEqual(
    [],
  );
});

// Wizard 390 px: no page-level horizontal scroll on any step.
test('wizard 390 px: no horizontal scroll on steps 1-5', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openNewProject(page, 'makine');
  for (const step of STEP_KEYS) {
    if (step !== 'makine') await goStep(page, step);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      step,
    ).toBe(true);
  }
});

// PO finding 2: the design system Select must replace native <select> in the wizard.
// BUG (reported): machine-step.tsx:92,149, layout-step.tsx:87, layout-view.tsx:480, paste-panel.tsx.
test('no native <select> in the wizard steps (design-system Select)', async ({ page }) => {
  await openNewProject(page, 'makine');
  expect(await page.locator('main select:visible').count()).toBe(0);
  await goStep(page, 'parcalar');
  await paste(page, KITCHEN, 5);
  await goStep(page, 'dizilim');
  await page
    .locator(
      'button[data-testid^="layout-mode-"][aria-pressed="true"]:visible, [data-testid="layout-nest-compact"]:visible',
    )
    .click();
  await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
  expect(await page.locator('main select:visible').count()).toBe(0);
});

// Layout step at 390 px: plate tabs must not overlap the grid checkbox row.
// BUG (reported): layout-view.tsx:339-363, "Plaka 3" wraps over "Milimetre ızgarası".
test('layout 390 px: plate tabs do not overlap the grid toggle', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openNewProject(page, 'parcalar');
  await paste(page, KITCHEN, 5);
  await goStep(page, 'dizilim');
  await page.getByTestId('layout-nest-compact').click();
  await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
  const tabs = await page.getByRole('tab').last().boundingBox();
  // T249: the grid is an icon toggle button now (same as the board).
  const grid = await page.getByTestId('layout-grid').boundingBox();
  if (!tabs || !grid) throw new Error('tab or grid toggle has no box');
  const overlap =
    tabs.x < grid.x + grid.width &&
    grid.x < tabs.x + tabs.width &&
    tabs.y < grid.y + grid.height &&
    grid.y < tabs.y + tabs.height;
  expect(overlap).toBe(false);
});
