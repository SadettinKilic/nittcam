import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  KITCHEN,
  closeWorkspacePanel,
  goStep,
  nest,
  openNewProject,
  openWorkspacePanel,
  paste,
  pasteAndNest,
} from './wizard-helpers';

// B10a tester (T240–T243, D-039): the gaps next to the dev spec b10a-board.spec.ts.

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error('no box');
  return b;
}

async function noHorizontalScroll(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    'no page-level horizontal scroll',
  ).toBe(true);
}

async function axeClean(page: Page) {
  const res = await new AxeBuilder({ page }).analyze();
  const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
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

async function view(canvas: Locator) {
  const [scale = 0, x = 0, y = 0] = ((await canvas.getAttribute('data-view')) ?? '')
    .split(',')
    .map(Number);
  return { scale, x, y };
}

// ---------------------------------------------------------------- T240 phone

for (const [w, h] of [
  [390, 844],
  [360, 740],
] as const) {
  test.describe(`B10a tester T240 phone ${w} × ${h}`, () => {
    test('steps 2 (Çizim), 3 and 4: canvas card ≥ 55 % of the viewport, no horizontal scroll', async ({
      page,
    }) => {
      const canvas = await openBoard(page, w, h);
      const ratios: Record<string, number> = {};
      ratios.board = (await box(canvas)).height / h;
      await noHorizontalScroll(page);
      await page.getByTestId('parts-view-list').click();
      await pasteAndNest(page, KITCHEN, 5, 'dizilim');
      ratios.dizilim = (await box(page.getByTestId('layout-workspace-canvas'))).height / h;
      await noHorizontalScroll(page);
      await goStep(page, 'simulasyon');
      const sim = page.getByTestId('sim-workspace-canvas');
      await expect(sim).toBeVisible({ timeout: 20_000 });
      ratios.simulasyon = (await box(sim)).height / h;
      await noHorizontalScroll(page);
      test.info().annotations.push({ type: 'ratios', description: JSON.stringify(ratios) });
      for (const [k, r] of Object.entries(ratios)) expect(r, k).toBeGreaterThanOrEqual(0.55);
    });

    test('step list popover by touch: tap opens it, blocked steps are marked, tap chooses', async ({
      browser,
    }) => {
      const ctx = await browser.newContext({
        viewport: { width: w, height: h },
        hasTouch: true,
        isMobile: true,
      });
      const page = await ctx.newPage();
      try {
        await openNewProject(page, 'parcalar');
        const header = await box(page.getByTestId('wizard-compact-header'));
        expect(header.height).toBeLessThanOrEqual(56);
        await expect(page.getByTestId('wizard-step-counter')).toHaveText(/^2\s*\/\s*5$/);
        await expect(page.getByTestId('wizard-progress').locator('span')).toHaveCount(5);
        await page.getByTestId('wizard-steps-trigger').tap();
        const pop = page.getByTestId('wizard-steps-popover');
        await expect(pop).toBeVisible();
        // The popover stays inside the viewport.
        const p = await box(pop);
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x + p.width).toBeLessThanOrEqual(w);
        // Nothing nested yet: Simülasyon is blocked and says why (same rule as desktop).
        const sim = page.getByTestId('wizard-step-simulasyon');
        await expect(sim).toHaveAttribute('data-status', 'blocked');
        const blockerTexts = Object.values(tr.wizard.steps.blocked) as string[];
        const simText = (await sim.textContent()) ?? '';
        expect(
          blockerTexts.some((b) => simText.includes(b)),
          simText,
        ).toBe(true);
        await expect(page.getByTestId('wizard-step-parcalar')).toHaveAttribute(
          'aria-current',
          'step',
        );
        // Tap a step: it opens, the popover closes, the heading says where we are.
        await page.getByTestId('wizard-step-makine').tap();
        await expect(page.getByTestId('wizard-steps-popover')).toHaveCount(0);
        await expect(page.getByTestId('wizard-step-title')).toHaveAttribute('data-step', 'makine');
        await expect(page.getByTestId('wizard-step-counter')).toHaveText(/^1\s*\/\s*5$/);
        // Name field only on step 1.
        await expect(page.getByTestId('project-name')).toBeVisible();
        await noHorizontalScroll(page);
      } finally {
        await ctx.close();
      }
    });

    test('step list popover by keyboard only: Tab into the list, Enter chooses, focus on heading', async ({
      page,
    }) => {
      await page.setViewportSize({ width: w, height: h });
      await openNewProject(page, 'parcalar');
      const trigger = page.getByTestId('wizard-steps-trigger');
      await expect(trigger).toHaveAttribute('aria-label', /.+/);
      await trigger.focus();
      await page.keyboard.press('Space');
      await expect(page.getByTestId('wizard-steps')).toBeVisible();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      // Focus moves into the popover; Tab reaches the Makine step.
      for (let i = 0; i < 6; i++) {
        const id = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
        if (id === 'wizard-step-makine') break;
        await page.keyboard.press('Tab');
      }
      await expect(page.getByTestId('wizard-step-makine')).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('wizard-step-title')).toHaveAttribute('data-step', 'makine');
      await expect(page.getByTestId('wizard-step-title')).toBeFocused();
      // Escape returns focus to the trigger.
      await trigger.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('wizard-steps')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('wizard-steps')).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });

    test('status bar: snap + zoom % + help, no cursor read-out; "?" opens the board shortcuts', async ({
      page,
    }) => {
      await openBoard(page, w, h);
      const status = page.getByTestId('editor-status');
      await expect(status.getByText(/^X /)).toBeHidden();
      await expect(status.getByText(/^Y /)).toBeHidden();
      await expect(page.getByTestId('editor-zoom').or(status.getByText(/%/)).first()).toBeVisible();
      const help = page.getByTestId('editor-shortcuts');
      const s = await box(status);
      const hb = await box(help);
      expect(hb.x + hb.width).toBeLessThanOrEqual(s.x + s.width + 0.5);
      await help.click();
      const dialog = page.getByTestId('shortcuts-dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(tr.shortcuts.groups.board);
      const d = await box(dialog);
      expect(d.x).toBeGreaterThanOrEqual(0);
      expect(d.x + d.width).toBeLessThanOrEqual(w);
    });
  });
}

// ---------------------------------------------------------------- T241 desktop

test.describe('B10a tester T241 desktop panels', () => {
  test('1440: same panel widths on Çizim, Dizilim, Simülasyon; canvas fills, no page scroll', async ({
    page,
  }) => {
    const canvas = await openBoard(page, 1440, 900);
    const c = await box(canvas);
    test.info().annotations.push({ type: 'board', description: `${c.width}×${c.height}` });
    const widths = async () => [
      (await box(page.getByTestId('workspace-left'))).width,
      (await box(page.getByTestId('workspace-right'))).width,
    ];
    const board = await widths();
    expect(board).toEqual([232, 264]);
    await page.getByTestId('parts-view-list').click();
    await pasteAndNest(page, KITCHEN, 5, 'dizilim');
    expect(await widths()).toEqual(board);
    await goStep(page, 'simulasyon');
    await expect(page.getByTestId('sim-workspace-canvas')).toBeVisible({ timeout: 20_000 });
    expect(await widths()).toEqual(board);
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
    ).toBeLessThanOrEqual(0);
    await noHorizontalScroll(page);
  });

  test('right panel collapse is remembered across reload and steps; canvas grows', async ({
    page,
  }) => {
    const canvas = await openBoard(page, 1440, 900);
    const before = (await box(canvas)).width;
    const right = page.getByTestId('workspace-right');
    await expect(right).toHaveAttribute('data-state', 'open');
    await page.getByTestId('workspace-right-toggle').click();
    await expect(right).toHaveAttribute('data-state', 'closed');
    await expect.poll(async () => (await box(canvas)).width).toBeGreaterThan(before + 150);
    expect(await page.evaluate(() => localStorage.getItem('nittcam-panel-right'))).toBe('closed');
    await page.reload();
    await expect(page.getByTestId('editor-canvas')).toHaveAttribute('data-view', /\d/);
    await expect(page.getByTestId('workspace-right')).toHaveAttribute('data-state', 'closed');
    // The same choice applies on Dizilim.
    await page.getByTestId('parts-view-list').click();
    await nest(page);
    await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('workspace-right')).toHaveAttribute('data-state', 'closed');
    // Reopen with the keyboard: the toggle is a named button.
    const toggle = page.getByTestId('workspace-right-toggle');
    await expect(toggle).toHaveAttribute('aria-label', /.+/);
    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('workspace-right')).toHaveAttribute('data-state', 'open');
    expect(await page.evaluate(() => localStorage.getItem('nittcam-panel-right'))).toBe('open');
  });

  test('1280: left panel open by default; 1024 stored "open" wins over the default', async ({
    page,
  }) => {
    await openBoard(page, 1280, 800);
    await expect(page.getByTestId('workspace-left')).toHaveAttribute('data-state', 'open');
    await page.evaluate(() => localStorage.setItem('nittcam-panel-left', 'open'));
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.reload();
    await expect(page.getByTestId('editor-canvas')).toHaveAttribute('data-view', /\d/);
    await expect(page.getByTestId('workspace-left')).toHaveAttribute('data-state', 'open');
    await noHorizontalScroll(page);
  });

  test('storage blocked: the board still opens with the defaults and toggles work', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const boom = () => {
        throw new DOMException('blocked', 'SecurityError');
      };
      Object.defineProperty(window, 'localStorage', { get: boom, configurable: true });
    });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openBoard(page, 1024, 768);
    await expect(page.getByTestId('workspace-left')).toHaveAttribute('data-state', 'closed');
    await page.getByTestId('workspace-left-toggle').click();
    await expect(page.getByTestId('workspace-left')).toHaveAttribute('data-state', 'open');
    expect(errors.filter((e) => /storage|blocked/i.test(e))).toEqual([]);
  });
});

// ---------------------------------------------------------------- T242 inspector

test.describe('B10a tester T242 inspector actions', () => {
  const ins = tr.editor.inspector;
  const names = [ins.mirrorH, ins.mirrorV, ins.rotate, ins.duplicate, ins.remove];

  test('1440: keyboard order of the icon row, tooltips "Ad · kısayol", Sil after a divider in danger', async ({
    page,
  }) => {
    const canvas = await openBoard(page, 1440, 900);
    await page.getByTestId('editor-part-list').getByRole('button').first().click();
    const bar = page.getByTestId('editor-inspector').getByRole('toolbar', { name: ins.actions });
    const buttons = bar.getByRole('button');
    await expect(buttons).toHaveCount(5);
    const labels = await buttons.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    expect(labels).toEqual(names);
    // One row: all buttons share a top edge and do not overlap.
    const boxes: { x: number; y: number; width: number; height: number }[] = [];
    const bx = (i: number) => boxes[i] ?? { x: 0, y: 0, width: 0, height: 0 };
    for (let i = 0; i < 5; i++) boxes.push(await box(buttons.nth(i)));
    for (let i = 1; i < 5; i++) {
      expect(Math.abs(bx(i).y - bx(0).y)).toBeLessThan(1);
      expect(bx(i).x).toBeGreaterThanOrEqual(bx(i - 1).x + bx(i - 1).width);
    }
    // Sil sits after a visible divider (a wider gap than between the others) in the danger colour.
    const gap = (i: number) => bx(i).x - (bx(i - 1).x + bx(i - 1).width);
    expect(gap(4)).toBeGreaterThan(gap(1));
    const colors = await buttons.evaluateAll((els) => els.map((e) => getComputedStyle(e).color));
    expect(colors[4]).not.toBe(colors[0]);
    // Every tooltip names the action and its shortcut.
    for (let i = 0; i < 5; i++) {
      const b = buttons.nth(i);
      await b.hover();
      const tip = page.getByRole('tooltip');
      await expect(tip).toContainText(`${names[i]} · `);
      const keys = await b.getAttribute('aria-keyshortcuts');
      expect(keys).toBeTruthy();
      // Move off the row (onto the canvas) so the next hover opens a fresh tooltip.
      const cb = await box(canvas);
      await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2, { steps: 4 });
      await expect(tip).toHaveCount(0);
    }
    // Keyboard: focus the first action, Tab walks the row in order, Enter acts and undo reverts.
    await buttons.nth(0).focus();
    for (let i = 1; i < 5; i++) {
      await page.keyboard.press('Tab');
      await expect(buttons.nth(i)).toBeFocused();
    }
    await buttons.nth(3).focus();
    await page.keyboard.press('Enter');
    await expect(canvas).toHaveAttribute('aria-label', /6 parça/);
    await page.keyboard.press('Control+z');
    await expect(canvas).toHaveAttribute('aria-label', /5 parça/);
  });

  test('summary with nothing selected: Parça and Adet and Toplam alan in m²', async ({ page }) => {
    await openBoard(page, 1440, 900);
    const summary = page.getByTestId('editor-summary');
    await expect(summary).toBeVisible();
    for (const k of ['parts', 'pieces', 'area', 'extents'] as const) {
      const label = (ins.summary as Record<string, string>)[k];
      if (label) await expect(summary).toContainText(label);
    }
    // Area is a positive number in m².
    const area = (await page.getByTestId('editor-summary-area').textContent()) ?? '';
    const n = Number(
      area
        .replace(/[^\d,.]/g, '')
        .replace(/\./g, '')
        .replace(',', '.'),
    );
    expect(n, area).toBeGreaterThan(0);
    // Selecting a part replaces the summary; Escape brings it back.
    await page.getByTestId('editor-part-list').getByRole('button').first().click();
    await expect(summary).toHaveCount(0);
    await page
      .getByTestId('editor-canvas')
      .click({ position: { x: 5, y: 5 } })
      .catch(() => {});
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('editor-summary')).toBeVisible();
  });

  test('390: mini-toolbar mirror acts and the selection stays; tap targets ≥ 32 px', async ({
    page,
  }) => {
    test.fail(
      true,
      'B10a-BUG3: the phone mini-toolbar covers the tool rail (rect/line tools); remove test.fail once fixed',
    );
    const canvas = await openBoard(page, 390, 844);
    const sheet = await openWorkspacePanel(page, 'left');
    await sheet.getByTestId('editor-part-list').getByRole('button').last().click();
    await closeWorkspacePanel(page);
    const mini = page.getByTestId('editor-mini-toolbar');
    await expect(mini).toBeVisible();
    for (const n of names) {
      const b = await box(mini.getByRole('button', { name: n, exact: true }));
      expect(b.width).toBeGreaterThanOrEqual(32);
      expect(b.height).toBeGreaterThanOrEqual(32);
    }
    const c = await box(canvas);
    const m = await box(mini);
    expect(m.x + m.width).toBeLessThanOrEqual(c.x + c.width);
    expect(m.x).toBeGreaterThanOrEqual(c.x);
    // The mini-toolbar must not cover the tool rail (its tools stay tappable).
    const rail = await box(page.getByRole('toolbar', { name: 'Çizim araçları' }));
    const overlaps =
      m.x < rail.x + rail.width &&
      rail.x < m.x + m.width &&
      m.y < rail.y + rail.height &&
      rail.y < m.y + m.height;
    expect(overlaps, 'mini-toolbar overlaps the tool rail').toBe(false);
    await mini.getByRole('button', { name: ins.remove, exact: true }).click();
    await expect(canvas).toHaveAttribute('aria-label', /4 parça/);
    await expect(mini).toHaveCount(0);
    await noHorizontalScroll(page);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`axe: board with a selection and the shortcuts dialog, 1440 ${scheme}`, async ({
      page,
    }) => {
      test.fail(
        true,
        'B10a-BUG1: shortcuts dialog list (.max-h-[60vh]) overflows and is not keyboard-focusable (axe scrollable-region-focusable); remove test.fail once fixed',
      );
      await page.emulateMedia({ colorScheme: scheme });
      await openBoard(page, 1440, 900);
      await axeClean(page); // summary state
      await page.getByTestId('editor-part-list').getByRole('button').first().click();
      await axeClean(page);
      await page.getByTestId('editor-shortcuts').click();
      await expect(page.getByTestId('shortcuts-dialog')).toBeVisible();
      await axeClean(page);
      await page.keyboard.press('Escape');
      await page.screenshot({ path: `__screenshots__/b10a-tester-1440-${scheme}.png` });
    });

    test(`axe: phone board with mini-toolbar and step popover, 390 ${scheme}`, async ({ page }) => {
      test.fail(
        true,
        'B10a-BUG2: phone step popover dialog has no accessible name (axe aria-dialog-name); remove test.fail once fixed',
      );
      await page.emulateMedia({ colorScheme: scheme });
      await openBoard(page, 390, 844);
      const sheet = await openWorkspacePanel(page, 'left');
      await sheet.getByTestId('editor-part-list').getByRole('button').first().click();
      await closeWorkspacePanel(page);
      await expect(page.getByTestId('editor-mini-toolbar')).toBeVisible();
      await axeClean(page);
      await page.screenshot({ path: `__screenshots__/b10a-tester-390-${scheme}.png` });
      await page.getByTestId('wizard-steps-trigger').click();
      await expect(page.getByTestId('wizard-steps')).toBeVisible();
      await axeClean(page);
      await page.screenshot({ path: `__screenshots__/b10a-tester-390-steps-${scheme}.png` });
    });
  }
});

// ---------------------------------------------------------------- T243 reference frame

test.describe('B10a tester T243 reference frame', () => {
  /** Non-background pixels in a small square of the canvas around a screen point. */
  async function inkAround(page: Page, canvas: Locator, x: number, y: number) {
    return canvas.evaluate(
      (el, p) => {
        const cv = (el.tagName === 'CANVAS' ? el : el.querySelector('canvas')) as HTMLCanvasElement;
        const ctx = cv.getContext('2d');
        if (!ctx) return -1;
        const r = cv.getBoundingClientRect();
        const k = cv.width / r.width;
        const bg = ctx.getImageData(
          Math.round((r.width - 4) * k),
          Math.round((r.height - 4) * k),
          1,
          1,
        ).data;
        const sx = Math.round((p.x - r.left) * k);
        const sy = Math.round((p.y - r.top) * k);
        const size = Math.round(34 * k);
        const d = ctx.getImageData(sx, sy - size, size, size).data;
        let ink = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (
            Math.abs((d[i] ?? 0) - (bg[0] ?? 0)) +
              Math.abs((d[i + 1] ?? 0) - (bg[1] ?? 0)) +
              Math.abs((d[i + 2] ?? 0) - (bg[2] ?? 0)) >
            60
          )
            ink++;
        }
        return ink;
      },
      { x, y },
    );
  }

  test('origin arrows stay visible with the grid and the sheet off', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'parcalar');
    await page.getByTestId('parts-view-drawing').click();
    const canvas = page.getByTestId('editor-canvas');
    await expect(canvas).toHaveAttribute('data-view', /\d/);
    await page.getByRole('button', { name: tr.editor.view.grid, exact: true }).click();
    await page.getByRole('button', { name: tr.editor.view.sheet, exact: true }).click();
    await page.waitForTimeout(200);
    const v = await view(canvas);
    const cb = await box(canvas);
    // Origin in page coordinates (data-view is relative to the canvas element).
    const ox = cb.x + v.x;
    const oy = cb.y + v.y;
    const ink = await inkAround(page, canvas, ox - 4, oy + 4);
    test.info().annotations.push({ type: 'origin-ink', description: String(ink) });
    // Two 24 px arms (≥ 48 px of stroke) plus arrow heads and labels.
    expect(ink).toBeGreaterThan(40);
  });

  test('fit with parts: the parts fill the canvas (scale well above the sheet fit)', async ({
    page,
  }) => {
    const canvas = await openBoard(page, 1440, 900);
    const withParts = (await view(canvas)).scale;
    const c = await box(canvas);
    const sheetFit = Math.min((c.width - 46 - 96) / 2800, (c.height - 22 - 96) / 2070);
    // Parts' extents are smaller than the sheet, so the padded part fit zooms in further.
    expect(withParts).toBeGreaterThan(sheetFit);
    // Zoom in, F fits back to the same view.
    await canvas.hover();
    await page.keyboard.press('+');
    await expect.poll(async () => (await view(canvas)).scale).toBeGreaterThan(withParts);
    await page.getByTestId('editor-fit').click();
    await expect.poll(async () => (await view(canvas)).scale).toBeCloseTo(withParts, 4);
  });
});
