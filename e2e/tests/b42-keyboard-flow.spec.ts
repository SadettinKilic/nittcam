import { expect, test, type Locator, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { KITCHEN, fill, wizardReady } from './wizard-helpers';

// T185 (spec §3.7, §11): the whole flow with the keyboard only (cut list → nest → simulation →
// export). Every control is reached with Tab / Shift+Tab and used with Enter / Space; the mouse
// is never used.

const MAX_TABS = 200;

/** Presses Tab (then Shift+Tab) until `target` has focus; fails when it is not reachable. */
async function tabTo(page: Page, target: Locator) {
  await expect(target).toBeVisible();
  const trail: string[] = [];
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let i = 0; i < MAX_TABS; i += 1) {
      if (await target.evaluate((el) => el === document.activeElement)) return;
      await page.keyboard.press(key);
      trail.push(
        await page.evaluate(() => {
          const el = document.activeElement;
          if (!el) return 'none';
          const id = el.getAttribute('data-testid') ?? el.getAttribute('aria-label') ?? '';
          return `${el.tagName}:${id || (el.textContent ?? '').trim().slice(0, 20)}`;
        }),
      );
    }
  }
  const tail = `${trail.slice(MAX_TABS - 12, MAX_TABS).join(' > ')} || ${trail.slice(-6).join(' > ')}`;
  throw new Error(`not reachable with Tab: ${target.toString()} (last: ${tail})`);
}

async function next(page: Page) {
  await tabTo(page, page.getByTestId('wizard-next'));
  await page.keyboard.press('Enter');
}

test('keyboard only: cut list, nesting, simulation and export', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  const t = tr.cutList;
  await page.goto('/projeler/yeni?adim=parcalar');
  await wizardReady(page, 'parcalar');

  // --- Cut list: the paste dialog, typed text, apply ---------------------------------------
  await tabTo(page, page.getByRole('button', { name: t.pasteOpen }));
  await page.keyboard.press('Enter');
  const text = page.getByLabel(t.paste.textLabel);
  await tabTo(page, text);
  await page.keyboard.insertText(KITCHEN);
  await tabTo(page, page.getByRole('button', { name: fill(t.paste.applyCount, { count: 5 }) }));
  await page.keyboard.press('Enter');
  await expect(text).toHaveCount(0);
  await expect(page.getByTestId('cut-list-count')).toHaveText(
    fill(t.count, { rows: 5, pieces: 30 }),
  );

  // --- Nesting -------------------------------------------------------------------------------
  await next(page);
  await wizardReady(page, 'dizilim');
  await tabTo(page, page.getByRole('button', { name: t.nesting.run, exact: true }));
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
  // The mode is a radio group: arrow keys change it.
  const mode = page.getByTestId('layout-mode');
  // Entering Dizilim nests by itself (T261); the group is disabled while a run is going.
  await expect(mode.getByRole('radio', { checked: true })).toBeEnabled();
  const before = await mode.getAttribute('data-value');
  await tabTo(page, mode.getByRole('radio', { checked: true }));
  // Held like a real key press: Radix checks the radio it focuses only while the arrow is down,
  // and it focuses one tick after keydown (an instant keyup would beat it).
  await page.keyboard.down('ArrowDown');
  await page.waitForTimeout(60);
  await page.keyboard.up('ArrowDown');
  await expect(mode).not.toHaveAttribute('data-value', before ?? '');

  // --- Simulation ----------------------------------------------------------------------------
  await next(page);
  await wizardReady(page, 'simulasyon');
  await expect(page.getByTestId('sim-check-status')).toHaveAttribute('data-ok', 'true', {
    timeout: 30_000,
  });
  // The G-code list is one tab stop; End and the arrows move the simulation line by line.
  const gcode = page.getByTestId('gcode-panel');
  await tabTo(page, gcode);
  await page.keyboard.press('End');
  await expect(gcode).not.toHaveAttribute('data-current-line', '');
  const end = Number(await gcode.getAttribute('data-current-line'));
  await page.keyboard.press('ArrowUp');
  await expect
    .poll(async () => Number(await gcode.getAttribute('data-current-line')))
    .toBeLessThan(end);

  // --- Export --------------------------------------------------------------------------------
  await next(page);
  await wizardReady(page, 'export');
  await expect(page.getByTestId('export-status')).toHaveAttribute('data-ok', 'true', {
    timeout: 30_000,
  });
  for (const id of ['export-check-origin', 'export-check-tool', 'export-check-aircut']) {
    await tabTo(page, page.getByTestId(id));
    await page.keyboard.press('Space');
    await expect(page.getByTestId(id)).toBeChecked();
  }
  const accept = page.getByTestId('export-accept');
  if ((await accept.count()) > 0) {
    await tabTo(page, accept);
    await page.keyboard.press('Space');
    await expect(accept).toBeChecked();
  }
  const download = page.getByTestId('export-download');
  await expect(download).toBeEnabled();
  await tabTo(page, download);
  await page.keyboard.press('Enter');
  // Three sheets = three files: each is a link in the ready list (one file downloads at once).
  const link = page.getByTestId('export-ready').getByRole('link').first();
  await expect(link).toBeVisible({ timeout: 30_000 });
  await tabTo(page, link);
  const [file] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
  expect(file.suggestedFilename()).toMatch(/.(nc|tap)$/i);
});
