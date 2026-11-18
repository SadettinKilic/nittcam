import { expect, test, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  STEP_KEYS,
  goStep,
  openNewProject,
  openWorkspacePanel,
  pasteAndNest,
} from './wizard-helpers';

/** B4b round 4 tester: header, phone layout step and simulation tiles after 8a2c7f6. */

const box = async (l: Locator) => {
  const b = await l.boundingBox();
  if (!b) throw new Error('element has no bounding box');
  return b;
};

const overlaps = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

async function noPageHScroll(page: Page) {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(over, 'no page-level horizontal scroll').toBeLessThanOrEqual(0);
}

for (const width of [1366, 1680, 1920]) {
  test(`header undo/redo inside the viewport on every step at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openNewProject(page, 'parcalar');
    await pasteAndNest(page);
    for (const step of STEP_KEYS) {
      await goStep(page, step);
      for (const name of [tr.cutList.undo, tr.cutList.redo]) {
        const b = await box(page.getByRole('button', { name, exact: true }).first());
        expect(b.x + b.width, `${name} on ${step}`).toBeLessThanOrEqual(width);
      }
      await noPageHScroll(page);
    }
  });
}

for (const width of [320, 390]) {
  test(`layout step at ${width} px: tabs on their own row, panel bar and legend visible`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await openNewProject(page, 'parcalar');
    await pasteAndNest(page);
    await goStep(page, 'dizilim');
    await noPageHScroll(page);

    const tab = page.getByRole('tab').filter({ visible: true }).first();
    await expect(tab).toBeVisible();
    const strip = await tab.evaluate((el) => {
      const r = el.closest('[role=tablist]')?.parentElement?.getBoundingClientRect();
      return { x: r?.x ?? 0, width: r?.width ?? 0 };
    });
    expect(strip.width, 'tab strip spans the canvas width').toBeGreaterThan(width - 80);
    const tabBox = await box(tab);
    const label = (await tab.innerText()).trim();
    expect(label).toMatch(/\d/);
    expect(tabBox.width, 'first tab shows its full label').toBeGreaterThanOrEqual(48);

    // The panel bar sticks above the footer and is fully inside the viewport.
    const bar = page.getByTestId('workspace-panel-bar');
    const footer = page.getByTestId('wizard-footer');
    const barBox = await box(bar);
    const footBox = await box(footer);
    expect(barBox.y, 'bar top on screen').toBeGreaterThanOrEqual(0);
    expect(barBox.y + barBox.height, 'bar above the footer').toBeLessThanOrEqual(footBox.y + 1);
    for (const btn of await bar.getByRole('button').filter({ visible: true }).all()) {
      const b = await box(btn);
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(width);
    }

    // "Açıklama" stays visible and is not hidden under the panel bar.
    const legend = page
      .getByRole('button', { name: tr.layout.legendButton, exact: true })
      .filter({ visible: true })
      .first();
    if (await legend.count()) {
      const lb = await box(legend);
      expect(overlaps(lb, barBox), 'legend clear of the panel bar').toBe(false);
      expect(lb.y + lb.height).toBeLessThanOrEqual(footBox.y);
    }
  });
}

for (const [width, height] of [
  [1440, 900],
  [390, 844],
] as const) {
  test(`simulation KPI values stay on one line at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openNewProject(page, 'parcalar');
    await pasteAndNest(page);
    await goStep(page, 'simulasyon');
    // On phones the summary card lives in the "Ayarlar" bottom sheet.
    if (width < 768) {
      await expect(page.getByTestId('workspace-open-left')).toBeVisible({ timeout: 30_000 });
      await openWorkspacePanel(page, 'left');
    }
    // T245: the six values are <dd>s of one compact list; the labels (<dt>) must not truncate.
    const values = page
      .locator(
        '[data-testid^="sim-summary-"]:not([data-testid="sim-summary-list"]), [data-testid="sim-summary-list"] dt',
      )
      .filter({ visible: true });
    await expect(values.first()).toBeVisible({ timeout: 30_000 });
    for (const v of await values.all()) {
      const r = await v.evaluate((el) => ({
        lines: Math.round(
          el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight),
        ),
        clipped: el.scrollWidth > el.clientWidth + 1,
        text: el.textContent,
      }));
      expect(r.lines, `${r.text} on one line`).toBe(1);
      expect(r.clipped, `${r.text} not truncated`).toBe(false);
    }
  });
}
