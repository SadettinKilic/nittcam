import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { KITCHEN, openNewProject, paste } from './wizard-helpers';

// B15 tester: T142 inner-contour operation picker (keyboard, allowed kinds, depth limit) and
// T143 thin-skin switch (keyboard, limit); 1440 / 1024 light + dark screenshots, axe, no h-scroll.

const kinds = tr.editor.inspector.operation.kinds;

async function screen(canvas: Locator, p: { x: number; y: number }) {
  const [scale = 0, x = 0, y = 0] = ((await canvas.getAttribute('data-view')) ?? '')
    .split(',')
    .map(Number);
  const b = await canvas.boundingBox();
  if (!b) throw new Error('no canvas');
  return { x: b.x + p.x * scale + x, y: b.y + y - p.y * scale };
}

const trNum = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'));

async function selectFirst(page: Page) {
  const show = page.getByRole('button', { name: 'Parça listesini göster' });
  if (await show.isVisible()) await show.click();
  await page.getByTestId('editor-part-list').getByRole('button').first().click();
}

/** Board with the first part selected and one drawn cut-out. */
async function boardWithInner(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  await openNewProject(page, 'parcalar');
  await paste(page, KITCHEN, 5);
  await page.getByTestId('parts-view-drawing').click();
  const canvas = page.getByTestId('editor-canvas');
  await expect(canvas).toHaveAttribute('data-view', /\d/);
  await selectFirst(page);
  const text = (await page.getByTestId('editor-position').textContent()) ?? '';
  const m = /X\s*(-?[\d.,]+)\s*·\s*Y\s*(-?[\d.,]+)/.exec(text);
  const p0 = { x: trNum(m?.[1] ?? 'NaN'), y: trNum(m?.[2] ?? 'NaN') };
  await page.keyboard.press('r');
  const a = await screen(canvas, { x: p0.x + 150, y: p0.y + 200 });
  const b = await screen(canvas, { x: p0.x + 400, y: p0.y + 500 });
  await page.keyboard.down('Alt');
  await page.mouse.click(a.x, a.y);
  await page.mouse.click(b.x, b.y);
  await page.keyboard.up('Alt');
  await page.getByTestId('inner-prompt-inner').click();
  await page.keyboard.press('v');
  await selectFirst(page);
  await expect(page.getByTestId('prop-op-inner-0')).toBeVisible();
}

async function axeClean(page: Page) {
  const res = await new AxeBuilder({ page }).analyze();
  const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
}

const noHScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('inner contour: inside / online / none by keyboard; depth ≥ thickness refused; undo', async ({
  page,
}) => {
  await boardWithInner(page, 1440);
  const picker = page.getByTestId('prop-op-inner-0');
  await expect(picker).toHaveAttribute('data-value', 'inside');
  await expect(picker).toContainText(kinds.inside);
  await picker.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('option')).toHaveText([kinds.inside, kinds.online, kinds.none]);
  await expect(page.getByRole('option', { name: kinds.inside })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', { name: kinds.online })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(picker).toHaveAttribute('data-value', 'online');
  const depth = page.getByTestId('prop-op-inner-0-depth');
  await expect(depth).toHaveValue('1');
  // Exactly the thickness is a through cut: refused, value stays.
  await depth.fill('18');
  await depth.press('Enter');
  await expect(page.getByTestId('prop-op-inner-0-depth-error')).toHaveText(
    tr.editor.inspector.operation.depthError,
  );
  await depth.press('Escape');
  await expect(depth).toHaveValue('1');
  await depth.fill('0');
  await depth.press('Enter');
  await expect(page.getByTestId('prop-op-inner-0-depth-error')).toBeVisible();
  await depth.press('Escape');
  await depth.fill('2,5');
  await depth.press('Enter');
  await expect(depth).toHaveValue('2,5');
  // Undo goes back one step (depth 1), then to the inside cut.
  await page.getByTestId('editor-canvas').focus();
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('prop-op-inner-0-depth')).toHaveValue('1');
  await page.keyboard.press('Control+z');
  await expect(picker).toHaveAttribute('data-value', 'inside');
});

test('thin skin: keyboard toggle; thickness ≥ material refused', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page);
  const sw = page.getByTestId('thin-skin-switch');
  await sw.focus();
  await page.keyboard.press('Space');
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  const thick = page.getByTestId('thin-skin-thickness');
  await expect(thick).toHaveValue('0,5');
  await thick.fill('18');
  await thick.press('Enter');
  await thick.press('Escape');
  await expect(thick).toHaveValue('0,5');
  await sw.focus();
  await page.keyboard.press('Space');
  await expect(sw).toHaveAttribute('aria-checked', 'false');
});

for (const width of [1440, 1024]) {
  for (const scheme of ['light', 'dark'] as const) {
    test(`operation picker ${width} px ${scheme}: screenshot, axe, no h-scroll`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await boardWithInner(page, width);
      const picker = page.getByTestId('prop-op-inner-0');
      await picker.click();
      await page.getByRole('option', { name: kinds.online }).click();
      await expect(page.getByTestId('prop-op-inner-0-depth')).toBeVisible();
      await page.getByTestId('prop-group-operation').scrollIntoViewIfNeeded();
      expect(await noHScroll(page)).toBe(true);
      await page.screenshot({ path: `__screenshots__/b15-op-panel-${width}-${scheme}.png` });
      await axeClean(page);
    });

    test(`thin skin ${width} px ${scheme}: screenshot, axe, no h-scroll`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: 900 });
      await openNewProject(page);
      await page.getByTestId('thin-skin-switch').click();
      await expect(page.getByTestId('thin-skin-thickness')).toBeVisible();
      await page.getByTestId('thin-skin').scrollIntoViewIfNeeded();
      expect(await noHScroll(page)).toBe(true);
      await page.screenshot({ path: `__screenshots__/b15-skin-${width}-${scheme}.png` });
      await axeClean(page);
    });
  }
}
