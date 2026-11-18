import { expect, test, type Locator, type Page } from '@playwright/test';
import { KITCHEN, goStep, openNewProject, paste } from './wizard-helpers';

// B10a (T240–T243, D-039): canvas budget and board polish. Bounding-box checks only; the
// visual baselines are reviewed by the tester.

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error('no box');
  return b;
}

async function openBoard(page: Page, width: number, height: number): Promise<Locator> {
  await page.setViewportSize({ width, height });
  await openNewProject(page, 'parcalar');
  await paste(page, KITCHEN, 5);
  await page.getByTestId('parts-view-drawing').click();
  const canvas = page.getByTestId('editor-canvas');
  await expect(canvas).toHaveAttribute('data-view', /\d/);
  return canvas;
}

for (const [w, h] of [
  [390, 844],
  [360, 740],
] as const) {
  test.describe(`T240 phone board ${w} × ${h}`, () => {
    test('one-row header, status bar visible, canvas ≥ 55 %', async ({ page }) => {
      const canvas = await openBoard(page, w, h);
      const header = await box(page.getByTestId('wizard-compact-header'));
      expect(header.height).toBeLessThanOrEqual(56);
      // No name field and no stepper card on step 2.
      await expect(page.getByTestId('project-name')).toHaveCount(0);
      await expect(page.getByTestId('wizard-steps')).toHaveCount(0);
      // The Liste / Çizim switch sits in the canvas band.
      const sw = await box(page.getByTestId('editor-view-switch'));
      const c = await box(canvas);
      expect(sw.y).toBeGreaterThanOrEqual(c.y);
      expect(sw.y + sw.height).toBeLessThanOrEqual(c.y + c.height);

      const status = await box(page.getByTestId('editor-status'));
      const bar = await box(page.getByTestId('workspace-panel-bar'));
      const footer = await box(page.getByTestId('wizard-footer'));
      expect(status.y + status.height).toBeLessThanOrEqual(bar.y + 0.5);
      expect(status.y + status.height).toBeLessThanOrEqual(footer.y + 0.5);
      expect(c.height / h).toBeGreaterThanOrEqual(0.55);
      // Phones: no hover, no cursor read-out.
      await expect(
        page.getByTestId('editor-cursor').getByText(/^X /).filter({ visible: true }),
      ).toHaveCount(0);

      // The rail starts right of the left ruler (22 px).
      const rail = await box(page.getByRole('toolbar', { name: 'Çizim araçları' }));
      expect(rail.x).toBeGreaterThanOrEqual(c.x + 22);
    });

    test('docked size bar stays above the panel bar, status bar visible', async ({ page }) => {
      const canvas = await openBoard(page, w, h);
      await page.getByTestId('editor-tool-rect').click();
      const c = await box(canvas);
      await page.mouse.click(c.x + c.width / 2, c.y + c.height / 2);
      const docked = await box(page.getByTestId('editor-dynamic-input'));
      const status = await box(page.getByTestId('editor-status'));
      const bar = await box(page.getByTestId('workspace-panel-bar'));
      expect(docked.y + docked.height).toBeLessThanOrEqual(status.y + 0.5);
      expect(status.y + status.height).toBeLessThanOrEqual(bar.y + 0.5);
    });

    test('step list popover: keyboard opens it, a step is chosen, locked stays locked', async ({
      page,
    }) => {
      await page.setViewportSize({ width: w, height: h });
      await openNewProject(page, 'parcalar');
      const trigger = page.getByTestId('wizard-steps-trigger');
      await trigger.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('wizard-steps')).toBeVisible();
      await expect(page.getByTestId('wizard-step-simulasyon')).toHaveAttribute(
        'data-status',
        'blocked',
      );
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('wizard-steps')).toHaveCount(0);
      await goStep(page, 'makine');
      await expect(page.getByTestId('project-name')).toBeVisible();
    });
  });
}
