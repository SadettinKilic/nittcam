import { expect, test, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { expectNoA11yViolations } from './visual/helpers';
import { goStep, KITCHEN, openNewProject, paste, pasteAndNest } from './wizard-helpers';

/**
 * T188 + mobile UI pass (T248, T255, CTO #4/#5 phone notes; D-043): every route at 390 / 768 /
 * 1024 / 1440 without a page-level sideways scroll; phone cut list cards and one-row toolbar;
 * phone simulation transport above the panel bar; touch pinch on the drawing board.
 */

const ROUTES = ['/', '/makineler', '/projeler', '/ayarlar', '/ayarlar/malzemeler', '/sablonlar'];
const WIDTHS = [
  [390, 844],
  [768, 1024],
  [1024, 768],
  [1440, 900],
] as const;

async function noSideScroll(page: Page, what: string) {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(over, `${what}: page-level horizontal scroll`).toBeLessThanOrEqual(1);
}

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error('no box');
  return b;
}

for (const [w, h] of WIDTHS) {
  test(`routes and wizard steps at ${w} × ${h}: no sideways scroll, primary action reachable`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: w, height: h });
    for (const url of ROUTES) {
      await page.goto(url);
      await expect(page.locator('main').first()).toBeVisible();
      await noSideScroll(page, `${w} ${url}`);
    }
    await openNewProject(page, 'parcalar');
    // Dizilim nests on arrival; at 1024 its settings panel starts collapsed ("Diz" inside).
    await paste(page, KITCHEN, 5);
    for (const step of ['parcalar', 'dizilim', 'simulasyon', 'export'] as const) {
      await goStep(page, step);
      await noSideScroll(page, `${w} step ${step}`);
    }
    // Step 5: "İndir" is the footer's primary action at every width.
    await expect(page.getByTestId('wizard-footer').getByTestId('export-download')).toBeInViewport();
  });
}

test.describe('phone cut list (T248)', () => {
  for (const [w, h] of [
    [390, 844],
    [360, 740],
  ] as const) {
    test(`${w} × ${h}: cards ≤ 88 px, ≥ 5 visible, toolbar in one row`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await openNewProject(page, 'parcalar');
      await paste(page, KITCHEN, 5);
      const cards = page.getByTestId('cut-list-card');
      await expect(cards.first()).toBeVisible();
      for (const card of (await cards.all()).slice(0, 5)) {
        expect((await box(card)).height).toBeLessThanOrEqual(88);
      }
      if (w === 390) {
        const visible = await cards.evaluateAll(
          (els) =>
            els.filter((e) => {
              const r = e.getBoundingClientRect();
              return r.top >= 0 && r.bottom <= window.innerHeight;
            }).length,
        );
        expect(visible).toBeGreaterThanOrEqual(5);
      }
      // One toolbar row: "Satır ekle", "İçe aktar" and "⋯" share a line.
      const add = await box(page.getByRole('button', { name: tr.cutList.addRow, exact: true }));
      const imp = await box(page.getByRole('button', { name: tr.cutList.pasteOpen, exact: true }));
      const more = await box(page.getByTestId('cut-list-more'));
      expect(Math.abs(add.y - imp.y)).toBeLessThan(4);
      expect(Math.abs(add.y - more.y)).toBeLessThan(4);
      // The rest sits in the menu.
      await page.getByTestId('cut-list-more').click();
      await expect(page.getByTestId('cabinet-open')).toBeVisible();
      await expect(page.getByTestId('cut-list-export')).toBeVisible();
      await page.keyboard.press('Escape');
      // A selection replaces the row: "n seçili · Toplu düzenle · ⋯ · ✕".
      await page.getByTestId('row-select-1').click();
      const bar = page.getByTestId('selection-bar');
      await expect(bar).toBeVisible();
      const bulk = await box(page.getByTestId('bulk-open'));
      const selMore = await box(page.getByTestId('selection-more'));
      expect(Math.abs(bulk.y - selMore.y)).toBeLessThan(4);
      await noSideScroll(page, `${w} cut list`);
      await expectNoA11yViolations(page);
    });
  }
});

test.describe('phone simulation (T255)', () => {
  for (const [w, h] of [
    [390, 844],
    [360, 740],
  ] as const) {
    test(`${w} × ${h}: transport above the panel bar, short header label, play/pause`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: w, height: h });
      await openNewProject(page, 'parcalar');
      await pasteAndNest(page);
      await goStep(page, 'simulasyon');
      await expect(page.getByTestId('sim-canvas')).toBeVisible({ timeout: 30_000 });
      await expect
        .poll(() => page.getByTestId('wizard-step-title').innerText())
        .toBe(tr.wizard.steps.short.simulasyon);
      const transport = page.getByTestId('sim-transport');
      // The drawing keeps ≥ 55 % of the height (T240), so the page scrolls to the transport; at
      // the end of the page the whole transport sits above the sticky panel bar.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      const t = await box(transport);
      const bar = await box(page.getByTestId('workspace-panel-bar'));
      expect(t.y + t.height).toBeLessThanOrEqual(bar.y + 1);
      for (const id of ['sim-scrubber', 'sim-clock', 'sim-play', 'sim-position']) {
        const b = await box(page.getByTestId(id));
        expect(b.y + b.height, id).toBeLessThanOrEqual(bar.y + 1);
        expect(b.y, id).toBeGreaterThanOrEqual(0);
      }
      const play = page.getByTestId('sim-play');
      await play.click();
      await expect(play).toHaveText(tr.simulation.controls.pause);
      await play.click();
      await expect(play).toHaveText(tr.simulation.controls.play);
      await noSideScroll(page, `${w} simulation`);
    });
  }

  test('1440: the long step name stays', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'parcalar');
    await pasteAndNest(page);
    await goStep(page, 'simulasyon');
    await expect(page.getByTestId('wizard-step-title').first()).toHaveText(
      tr.wizard.steps.simulasyon,
    );
  });
});

test.describe('touch (T188)', () => {
  test.use({ viewport: { width: 768, height: 1024 }, hasTouch: true, isMobile: true });

  test('tablet touch: toolbar buttons are at least 40 px high', async ({ page }) => {
    await openNewProject(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    for (const name of [tr.cutList.addRow, tr.cutList.pasteOpen]) {
      const b = await box(page.getByRole('button', { name, exact: true }));
      expect(b.height, name).toBeGreaterThanOrEqual(40);
    }
  });

  test('two-finger pinch zooms the drawing board', async ({ page }) => {
    await openNewProject(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    await page.getByTestId('parts-view-drawing').click();
    const canvas = page.getByTestId('editor-canvas');
    await expect(canvas).toHaveAttribute('data-view', /\d/);
    const scale = async () => Number((await canvas.getAttribute('data-view'))?.split(',')[0]);
    const s0 = await scale();
    const b = await box(canvas);
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const cdp = await page.context().newCDPSession(page);
    const pts = (d: number) => [
      { x: cx - d, y: cy, id: 1 },
      { x: cx + d, y: cy, id: 2 },
    ];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(30) });
    for (let i = 1; i <= 10; i += 1) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: pts(30 + i * 8),
      });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await expect.poll(scale).toBeGreaterThan(s0);
  });
});

test.describe('phone dialogs and forms (CTO #4 / #5 notes)', () => {
  test('390: cabinet dialog door row stacks, labels on one line', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openNewProject(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    await page.getByTestId('cut-list-more').click();
    await page.getByTestId('cabinet-open').click();
    const doors = page.getByTestId('cabinet-doors');
    await expect(doors).toBeVisible();
    const gap = page.getByLabel(tr.cutList.cabinet.fields.doorGap);
    if ((await gap.count()) > 0) {
      // The gap field sits below the door choice, not beside it.
      expect((await box(gap.first())).y).toBeGreaterThan((await box(doors)).y + 10);
    }
    await noSideScroll(page, 'cabinet dialog');
  });
});
