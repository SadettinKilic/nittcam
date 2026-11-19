import { expect, test, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  KITCHEN,
  closeWorkspacePanel,
  goStep,
  openNewProject,
  openWorkspacePanel,
  paste,
} from './wizard-helpers';

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

test.describe('T242 inspector icon actions', () => {
  const ins = tr.editor.inspector;
  const names = [ins.mirrorH, ins.mirrorV, ins.rotate, ins.duplicate, ins.remove];

  test('1440: one icon row with tooltips + shortcuts, summary, help from the status bar', async ({
    page,
  }) => {
    await openBoard(page, 1440, 900);
    const inspector = page.getByTestId('editor-inspector');
    // Nothing selected: compact summary instead of an empty panel.
    await expect(page.getByTestId('editor-summary')).toBeVisible();
    await expect(page.getByTestId('editor-summary-area')).toContainText(ins.summary.areaUnit);
    await expect(page.getByTestId('editor-summary-extents')).toContainText('×');

    await page.getByTestId('editor-part-list').getByRole('button').first().click();
    const bar = inspector.getByRole('toolbar', { name: ins.actions });
    for (const n of names) {
      const b = bar.getByRole('button', { name: n, exact: true });
      await expect(b).toBeVisible();
      const bb = await box(b);
      expect(Math.round(bb.width)).toBe(32);
      expect(Math.round(bb.height)).toBe(32);
      await expect(b).toHaveAttribute('aria-keyshortcuts', /.+/);
    }
    // No shortcut prose in the panel.
    await expect(inspector).not.toContainText('Kısayollar:');
    await bar.getByRole('button', { name: ins.mirrorH, exact: true }).hover();
    await expect(page.getByRole('tooltip')).toContainText(`${ins.mirrorH} · Shift+X`);

    await page.getByTestId('editor-shortcuts').click();
    const dialog = page.getByTestId('shortcuts-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(tr.shortcuts.groups.board);
    await expect(dialog.getByTestId('shortcut-boardMirrorH')).toContainText(
      tr.shortcuts.items.boardMirrorH,
    );
  });

  test('390: mini-toolbar over the selection stays inside the canvas and acts', async ({
    page,
  }) => {
    const canvas = await openBoard(page, 390, 844);
    const sheet = await openWorkspacePanel(page, 'left');
    await sheet.getByTestId('editor-part-list').getByRole('button').first().click();
    await closeWorkspacePanel(page);
    const mini = page.getByTestId('editor-mini-toolbar');
    await expect(mini).toBeVisible();
    const c = await box(canvas);
    const m = await box(mini);
    expect(m.x).toBeGreaterThanOrEqual(c.x);
    expect(m.y).toBeGreaterThanOrEqual(c.y);
    expect(m.x + m.width).toBeLessThanOrEqual(c.x + c.width);
    expect(m.y + m.height).toBeLessThanOrEqual(c.y + c.height);
    for (const n of names) {
      await expect(mini.getByRole('button', { name: n, exact: true })).toBeVisible();
    }
    await mini.getByRole('button', { name: ins.duplicate, exact: true }).click();
    await expect(canvas).toHaveAttribute('aria-label', /6 parça/);
  });
});

test.describe('T243 board reference frame', () => {
  test('empty board: fit frames the sheet outline with 48 px padding', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'parcalar');
    await page.getByTestId('parts-view-drawing').click();
    const canvas = page.getByTestId('editor-canvas');
    await expect(canvas).toHaveAttribute('data-view', /\d/);
    const c = await box(canvas);
    const [scale = 0] = ((await canvas.getAttribute('data-view')) ?? '').split(',').map(Number);
    // Default stock sheet 2800 × 2070; free area right of ruler + rail and below the ruler.
    const expected = Math.min((c.width - 46 - 96) / 2800, (c.height - 22 - 96) / 2070);
    expect(scale).toBeCloseTo(expected, 3);
  });

  test('grid and sheet are icon toggles; the sheet toggle is view state only', async ({ page }) => {
    await openBoard(page, 1440, 900);
    const grid = page.getByRole('button', { name: tr.editor.view.grid, exact: true });
    const sheet = page.getByRole('button', { name: tr.editor.view.sheet, exact: true });
    await expect(grid).toHaveAttribute('aria-pressed', 'true');
    await expect(sheet).toHaveAttribute('aria-pressed', 'true');
    await grid.click();
    await expect(grid).toHaveAttribute('aria-pressed', 'false');
    const status = page.getByTestId('save-status');
    await expect(status).toHaveAttribute('data-state', /^(saved|idle)$/, { timeout: 15_000 });
    const revision = await status.getAttribute('data-revision');
    const undo = page.getByTestId('wizard-undo');
    const undoState = await undo.isDisabled();
    await sheet.click();
    await expect(sheet).toHaveAttribute('aria-pressed', 'false');
    await sheet.click();
    await expect(sheet).toHaveAttribute('aria-pressed', 'true');
    // No command: nothing to save, nothing new to undo.
    await page.waitForTimeout(500);
    await expect(status).toHaveAttribute('data-revision', revision ?? '');
    expect(await undo.isDisabled()).toBe(undoState);
  });

  test('390: toggles are icon buttons inside the canvas band', async ({ page }) => {
    const canvas = await openBoard(page, 390, 844);
    const c = await box(canvas);
    for (const name of [tr.editor.view.grid, tr.editor.view.sheet]) {
      const b = await box(page.getByRole('button', { name, exact: true }));
      expect(b.x + b.width).toBeLessThanOrEqual(c.x + c.width);
      expect(b.width).toBeLessThanOrEqual(36);
    }
  });
});
