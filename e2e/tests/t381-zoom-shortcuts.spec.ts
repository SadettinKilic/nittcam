import { expect, test, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { goStep, KITCHEN, openNewProject, paste } from './wizard-helpers';

// T381 (owner 2026-11-28): zoom controls show their shortcuts; the keys work on each canvas.

/** Moves onto the canvas so the next hover opens a fresh tooltip (as in b10a-board-tester). */
async function offControls(page: Page, canvas: Locator) {
  const b = await canvas.boundingBox();
  if (b) await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
  await expect(page.getByRole('tooltip')).toHaveCount(0);
}

test('T381 Dizilim: tooltips name the keys; + / - / F / 0 zoom the canvas, not inside an input', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await paste(page, KITCHEN, 5);
  await goStep(page, 'dizilim');
  const canvas = page.getByTestId('layout-canvas');
  await expect(canvas).toBeVisible({ timeout: 20_000 });

  await offControls(page, canvas);
  await page.getByRole('button', { name: tr.layout.zoomIn, exact: true }).hover();
  await expect(
    page.getByRole('tooltip').filter({ hasText: `${tr.layout.zoomIn} · +` }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: tr.layout.zoomOut, exact: true })).toHaveAttribute(
    'aria-keyshortcuts',
    '-',
  );
  await offControls(page, canvas);
  await page.getByRole('button', { name: tr.layout.fit, exact: true }).hover();
  await expect(page.getByRole('tooltip').filter({ hasText: `${tr.layout.fit} · F` })).toBeVisible();

  await expect(canvas).toHaveAttribute('data-scale', /\d/);
  const start = Number(await canvas.getAttribute('data-scale'));
  await canvas.focus();
  await page.keyboard.press('+');
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-scale')))
    .toBeGreaterThan(start);
  const zoomed = Number(await canvas.getAttribute('data-scale'));
  await page.keyboard.press('f');
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-scale')))
    .toBeLessThan(zoomed);
  const fitted = Number(await canvas.getAttribute('data-scale'));
  await page.keyboard.press('-');
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-scale')))
    .toBeLessThan(fitted);
  await page.keyboard.press('0');
  await expect.poll(async () => Number(await canvas.getAttribute('data-scale'))).toBeGreaterThan(0);

  // Typing "+" in a field does not zoom.
  const before = await canvas.getAttribute('data-scale');
  const gap = page.getByTestId('layout-gap');
  await gap.focus();
  await page.keyboard.press('+');
  await expect(canvas).toHaveAttribute('data-scale', before ?? '');
  await page.keyboard.press('Escape');
});

test('T381 Simülasyon: + and F zoom the canvas; the help sheet lists the canvas keys', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await paste(page, KITCHEN, 5);
  await goStep(page, 'dizilim');
  await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
  await goStep(page, 'simulasyon');
  const canvas = page.getByTestId('sim-canvas');
  await expect(canvas).toHaveAttribute('data-scale', /\d/, { timeout: 30_000 });
  const start = Number(await canvas.getAttribute('data-scale'));
  await offControls(page, canvas);
  await page.getByRole('button', { name: tr.simulation.controls.zoomIn, exact: true }).hover();
  await expect(
    page.getByRole('tooltip').filter({ hasText: `${tr.simulation.controls.zoomIn} · +` }),
  ).toBeVisible();
  await offControls(page, canvas);
  await page.locator('body').press('+');
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-scale')))
    .toBeGreaterThan(start);
  const zoomed = Number(await canvas.getAttribute('data-scale'));
  await page.locator('body').press('f');
  await expect
    .poll(async () => Number(await canvas.getAttribute('data-scale')))
    .toBeLessThan(zoomed);

  await page.locator('body').press('?');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(tr.shortcuts.groups.canvas);
  await expect(dialog).toContainText(tr.shortcuts.items.canvasFit);
});
