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

test.describe('T241 desktop canvas budget', () => {
  test('1440 × 900: canvas ≥ 640 × 660 with both panels, switch in the header row', async ({
    page,
  }) => {
    const canvas = await openBoard(page, 1440, 900);
    const c = await box(canvas);
    expect(c.width).toBeGreaterThanOrEqual(640);
    expect(c.height).toBeGreaterThanOrEqual(660);
    expect((await box(page.getByTestId('workspace-left'))).width).toBe(232);
    expect((await box(page.getByTestId('workspace-right'))).width).toBe(264);
    // The switch shares the row with the stepper.
    const sw = await box(page.getByTestId('wizard-view-switch'));
    const steps = await box(page.getByTestId('wizard-steps'));
    expect(sw.x + sw.width).toBeLessThanOrEqual(steps.x);
    expect(Math.abs(sw.y + sw.height / 2 - (steps.y + steps.height / 2))).toBeLessThan(24);
    // The collapse buttons sit in their panel header rows (title / count).
    for (const side of ['left', 'right'] as const) {
      const head = await box(page.getByTestId(`workspace-${side}-header`));
      const btn = await box(page.getByTestId(`workspace-${side}-toggle`));
      expect(btn.y).toBeGreaterThanOrEqual(head.y - 0.5);
      expect(btn.y + btn.height).toBeLessThanOrEqual(head.y + head.height + 0.5);
    }
    await expect(page.getByTestId('workspace-left-header')).toContainText('5 parça');
  });

  for (const [w, h] of [
    [1440, 900],
    [1280, 800],
    [1024, 768],
  ] as const) {
    test(`${w} × ${h}: no page scroll on the board and Dizilim, same panel width`, async ({
      page,
    }) => {
      await openBoard(page, w, h);
      const room = () =>
        page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
      expect(await room()).toBeLessThanOrEqual(0);
      const width = async () => (await box(page.getByTestId('workspace-left'))).width;
      const left = await width();
      expect(left).toBe(w < 1280 ? 40 : 232);
      await page.getByTestId('parts-view-list').click();
      await goStep(page, 'dizilim');
      expect(await room()).toBeLessThanOrEqual(0);
      expect(await width()).toBe(left);
    });
  }

  test('1024: left panel starts collapsed; the choice survives a reload', async ({ page }) => {
    await openBoard(page, 1024, 768);
    const left = page.getByTestId('workspace-left');
    await expect(left).toHaveAttribute('data-state', 'closed');
    await page.getByTestId('workspace-left-toggle').click();
    await expect(left).toHaveAttribute('data-state', 'open');
    await page.reload();
    await expect(page.getByTestId('editor-canvas')).toHaveAttribute('data-view', /\d/);
    await expect(page.getByTestId('workspace-left')).toHaveAttribute('data-state', 'open');
  });
});
