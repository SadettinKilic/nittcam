/**
 * B12a / T266 (CTO review #5): the corner tools fit the 264 px properties panel and stay
 * reachable. The panel never scrolls sideways; picking a corner brings the "Köşe" group's radius,
 * "Köşeyi yuvarla" and "Taşma aç" into view at 1440 × 900 and 1024 × 768; a toast never covers
 * the group's fields.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { KITCHEN, fill, openNewProject, paste, pickOption } from './wizard-helpers';

const ins = tr.editor.inspector;

async function openBoard(page: Page, width: number, height: number): Promise<Locator> {
  await page.setViewportSize({ width, height });
  await openNewProject(page, 'parcalar');
  await paste(page, KITCHEN, 5);
  await page.getByTestId('parts-view-drawing').click();
  const canvas = page.getByTestId('editor-canvas');
  await expect(canvas).toHaveAttribute('data-view', /\d/);
  return canvas;
}

/** An L part drawn with the line tool (inner corner = vertex 4), as in b11-props. */
async function drawL(page: Page, canvas: Locator) {
  const b = await canvas.boundingBox();
  if (!b) throw new Error('no canvas');
  await page.keyboard.press('l');
  await page.mouse.click(b.x + b.width * 0.55, b.y + b.height * 0.8);
  for (const [len, angle] of [
    [600, 0],
    [300, 90],
    [300, 180],
    [300, 90],
    [300, 180],
    [600, 270],
  ] as const) {
    await page.keyboard.type(String(len));
    await page.keyboard.press('Tab');
    await page.keyboard.type(String(angle));
    await page.keyboard.press('Enter');
  }
  await page.keyboard.press('v');
  await expect(page.getByTestId('editor-size')).toHaveText(/600\s*×\s*600/);
}

/** The panel's scrolling body (inside `workspace-right`). */
const scroller = (page: Page) => page.locator('[data-testid="workspace-right"] > [data-density]');

async function box(l: Locator) {
  const b = await l.boundingBox();
  if (!b) throw new Error('no box');
  return b;
}

/** Fully inside the viewport, the panel's visible area, and above the wizard footer. */
async function reachable(page: Page, l: Locator) {
  const b = await box(l);
  const panel = await box(scroller(page));
  const footer = await box(page.getByTestId('wizard-footer'));
  const vp = page.viewportSize();
  if (!vp) throw new Error('no viewport');
  expect(b.x).toBeGreaterThanOrEqual(panel.x - 0.5);
  expect(b.x + b.width).toBeLessThanOrEqual(Math.min(vp.width, panel.x + panel.width) + 0.5);
  expect(b.y).toBeGreaterThanOrEqual(panel.y - 0.5);
  expect(b.y + b.height).toBeLessThanOrEqual(Math.min(panel.y + panel.height, footer.y) + 0.5);
}

const overlaps = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

for (const [w, h] of [
  [1440, 900],
  [1024, 768],
] as const) {
  test(`T266 ${w} × ${h}: corner tools fit the panel, come into view, no toast on them`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const canvas = await openBoard(page, w, h);
    await drawL(page, canvas);

    // The inner corner from the list (vertex 4).
    await pickOption(page.getByTestId('prop-vertex-pick'), fill(ins.vertexN, { n: 4 }));
    await expect(page.getByTestId('prop-dogbone')).toBeVisible();

    // Never sideways: content width = panel width.
    const sideways = await scroller(page).evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(sideways).toBeLessThanOrEqual(0);

    // Radius, "Köşeyi yuvarla" and "Taşma aç" without scrolling.
    await expect
      .poll(async () => (await box(page.getByTestId('prop-dogbone'))).y, { timeout: 3000 })
      .toBeGreaterThan(0);
    await page.waitForTimeout(300); // smooth scroll settles
    for (const id of ['prop-fillet-r', 'prop-fillet', 'prop-dogbone']) {
      await reachable(page, page.getByTestId(id));
    }

    // Dogbone: its toast does not sit on the group's fields.
    await page.getByTestId('prop-dogbone').click();
    const toast = page
      .locator('[data-sonner-toast]')
      .filter({ hasText: ins.dogbone.added.split(' {')[0] ?? '' })
      .first();
    await expect(toast).toBeVisible();
    await page.waitForTimeout(500);
    const tb = await box(toast);
    for (const id of ['prop-vertex-pick', 'prop-vertex-x', 'prop-vertex-y', 'prop-fillet-r']) {
      const f = page.getByTestId(id);
      if ((await f.count()) === 0) continue;
      expect(overlaps(tb, await box(f)), id).toBe(false);
    }
    expect(overlaps(tb, await box(page.getByTestId('prop-group-vertex')))).toBe(false);
  });
}
