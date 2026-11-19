import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import {
  KITCHEN,
  goStep,
  openNewProject,
  paste,
  pasteAndNest,
  pickOption,
  saved,
} from './wizard-helpers';

// B8a tester (T249–T251): the footer "İndir" keeps the export gate exactly (every combination of
// the checklist and the acceptance, by click and by keyboard, no request leaks out), the
// unverified-profile block and every safety string stay; the wood tone at 1440 light/dark with a
// locked part told apart without colour.
const w = tr.wizard.export;
const CHECKS = ['export-check-origin', 'export-check-tool', 'export-check-aircut', 'export-accept'];

async function toExport(page: Page) {
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page);
  await saved(page);
  await goStep(page, 'export');
  await expect(page.getByTestId('export-status')).toHaveAttribute('data-ok', 'true', {
    timeout: 30_000,
  });
}

/** Records every non-GET export request (the download is a POST to the exports API). */
function watchExportPosts(page: Page): string[] {
  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() !== 'GET' && /export/i.test(r.url())) posts.push(`${r.method()} ${r.url()}`);
  });
  return posts;
}

test('safety: every incomplete combination of checklist + acceptance keeps "İndir" disabled', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await toExport(page);
  const posts = watchExportPosts(page);
  const download = page.getByTestId('wizard-footer').getByTestId('export-download');

  // The unverified example profile: block visible, acceptance required.
  await expect(page.getByTestId('export-unverified')).toBeVisible();
  await expect(page.getByTestId('export-unverified-reasons')).toBeVisible();

  for (let mask = 0; mask < 16; mask++) {
    for (let i = 0; i < 4; i++) {
      await page.getByTestId(CHECKS[i] ?? '').setChecked((mask & (1 << i)) !== 0);
    }
    if (mask === 15) {
      await expect(download, `mask ${mask}`).toBeEnabled();
    } else {
      await expect(download, `mask ${mask}`).toBeDisabled();
      // Forced click and synthetic click on the disabled button do nothing.
      await download.click({ force: true });
      await download.dispatchEvent('click');
      await expect(page.getByTestId('export-hint')).not.toHaveText('');
    }
  }
  await page.waitForTimeout(300);
  expect(posts).toEqual([]);
});

test('safety: keyboard only, İndir is unreachable until all ticked, then Enter downloads', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await toExport(page);
  const posts = watchExportPosts(page);
  const download = page.getByTestId('wizard-footer').getByTestId('export-download');

  // Tab through the whole page: the disabled İndir is never focused.
  await page.getByTestId('export-check-origin').focus();
  const seen: string[] = [];
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press('Tab');
    seen.push(await page.evaluate(() => document.activeElement?.getAttribute('data-testid') ?? ''));
  }
  expect(seen).not.toContain('export-download');
  expect(posts).toEqual([]);

  // Tick with Space only, in the order of the page.
  for (const id of CHECKS) {
    await page.getByTestId(id).focus();
    await page.keyboard.press('Space');
    await expect(page.getByTestId(id)).toBeChecked();
    if (id !== 'export-accept') await expect(download).toBeDisabled();
  }
  await expect(download).toBeEnabled();
  // Untick one by keyboard: disabled again; tick again.
  await page.getByTestId('export-check-tool').focus();
  await page.keyboard.press('Space');
  await expect(download).toBeDisabled();
  await page.keyboard.press('Space');
  await expect(download).toBeEnabled();

  // Tab forward from the acceptance until İndir is focused, then Enter.
  await page.getByTestId('export-accept').focus();
  let reached = false;
  for (let i = 0; i < 80 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await download.evaluate((el) => el === document.activeElement);
  }
  expect(reached).toBe(true);
  const ready = page.waitForRequest((r) => r.method() === 'POST' && /export/i.test(r.url()));
  await page.keyboard.press('Enter');
  await ready;
});

test('safety strings: the checklist, warnings and air-cut sentence are on the export step', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await toExport(page);
  const body = await page.locator('main').innerText();
  for (const key of ['checklistTitle', 'serverNote'] as const) {
    expect(body, key).toContain(w[key]);
  }
  for (const id of CHECKS) await expect(page.getByTestId(id)).toBeVisible();
  // The air-cut check label (with or without parameters) is present and unchanged.
  const airCut = w.checkAirCut.split('{')[0]?.trim() ?? '';
  expect(body).toContain(airCut);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`wood tone 1440 ${scheme}: Dizilim with a locked part, Simülasyon, board`, async ({
    page,
  }) => {
    test.setTimeout(150_000);
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'parcalar');
    await pasteAndNest(page);
    await pickOption(page.getByTestId('layout-select'), { index: 1 });
    await page.getByRole('button', { name: tr.layout.info.lock }).click();
    await expect(page.getByTestId('layout-info-locked')).toHaveText(tr.layout.info.lockedYes);
    // Select another part so the locked one shows its dashed outline (not the selection stroke).
    await pickOption(page.getByTestId('layout-select'), { index: 2 });
    await page.screenshot({ path: `__screenshots__/b08a-dizilim-1440-${scheme}.png` });
    // Legend swatch for "locked" is dashed: a non-colour cue.
    await page.getByTestId('layout-legend-button').click();
    await expect(page.locator('span.border-dashed.border-part-locked-stroke')).toHaveCount(1);
    await page.keyboard.press('Escape');

    await goStep(page, 'simulasyon');
    await expect(page.getByTestId('sim-tabs-scroll')).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `__screenshots__/b08a-sim-1440-${scheme}.png` });

    await openNewProject(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    await page.getByTestId('parts-view-drawing').click();
    await expect(page.getByTestId('editor-canvas')).toHaveAttribute('data-view', /\d/);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `__screenshots__/b08a-board-1440-${scheme}.png` });
  });
}
