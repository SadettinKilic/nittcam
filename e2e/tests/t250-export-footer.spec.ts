import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { KITCHEN, goStep, openNewProject, pasteAndNest, saved } from './wizard-helpers';

// T250 (D-040): the last step's "İndir" is the wizard footer's primary button, gated exactly as
// before; file rows never break inside a word; the history uses the same row. Plus the T248
// import-panel bullet: the apply / cancel row stays on screen, the intro is one sentence.
const w = tr.wizard.export;
const c = tr.cutList;

async function toExport(page: Page) {
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page);
  await saved(page);
  await goStep(page, 'export');
  await expect(page.getByTestId('export-status')).toHaveAttribute('data-ok', 'true', {
    timeout: 30_000,
  });
}

/** The element is fully inside the viewport (no scrolling needed). */
async function inViewport(page: Page, testId: string) {
  const box = await page.getByTestId(testId).boundingBox();
  const vp = page.viewportSize();
  if (!box || !vp) throw new Error(`${testId} has no box`);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 0.5);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 0.5);
}

/** No text node of the element wraps: every line box of a single-line element is one line. */
async function oneLine(page: Page, testId: string) {
  const rows = page.getByTestId(testId);
  const n = await rows.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const h = await rows.nth(i).evaluate((el) => el.getBoundingClientRect().height);
    expect(h, `${testId}[${i}]`).toBeLessThan(22);
  }
}

test('1440: "İndir" sits in the footer, gated by checklist + acceptance (click and keyboard)', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await toExport(page);

  const footer = page.getByTestId('wizard-footer');
  const download = footer.getByTestId('export-download');
  await expect(download).toHaveText(w.download);
  await expect(page.getByTestId('export-download')).toHaveCount(1);
  await expect(page.getByRole('button', { name: w.download, exact: true })).toHaveCount(1);
  await expect(footer.getByTestId('wizard-next')).toHaveCount(0);
  await inViewport(page, 'export-download');

  await expect(download).toBeDisabled();
  await expect(footer.getByTestId('export-hint')).toHaveText(w.needChecks);
  await expect(footer.getByTestId('export-hint')).toBeVisible();
  // Keyboard: Space ticks a checkbox.
  await page.getByTestId('export-check-origin').focus();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('export-check-origin')).toBeChecked();
  await expect(download).toBeDisabled();
  await page.getByTestId('export-check-tool').check();
  await page.getByTestId('export-check-aircut').check();
  await expect(download).toBeDisabled();
  await expect(footer.getByTestId('export-hint')).toHaveText(w.needAccept);
  await page.getByTestId('export-accept').check();
  await expect(download).toBeEnabled();
  await expect(footer.getByTestId('export-hint')).toHaveText('');
  // Unticking one box disables it again.
  await page.getByTestId('export-check-aircut').uncheck();
  await expect(download).toBeDisabled();
  await page.getByTestId('export-check-aircut').check();

  // File rows: name and meta lines on one line each; Turkish size; 8-char hash; full hash copy.
  await oneLine(page, 'export-file-meta');
  const meta = page.getByTestId('export-files').getByTestId('export-file-meta').first();
  await expect(meta).toHaveText(/^\d+(,\d)? (B|KB|MB) · sha256 [0-9a-f]{8}…$/);
  const copy = page.getByTestId('export-files').getByTestId('export-file-copy').first();
  const fullHash = (await copy.getAttribute('data-hash')) ?? '';
  expect(fullHash).toMatch(/^[0-9a-f]{64}$/);
  expect((await meta.innerText()).includes(fullHash.slice(0, 8))).toBe(true);
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await copy.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(fullHash);

  // Download from the footer; the downloaded bytes match the full hash of their row.
  const files = await page.getByTestId('export-files').locator('li').count();
  const first =
    files === 1
      ? (await Promise.all([page.waitForEvent('download'), download.click()]))[0]
      : await (async () => {
          await download.click();
          const link = page.getByTestId('export-ready').getByRole('link').first();
          return (await Promise.all([page.waitForEvent('download'), link.click()]))[0];
        })();
  const bytes = await readFile(await first.path());
  const hashes = await page
    .getByTestId('export-files')
    .getByTestId('export-file-copy')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-hash')));
  expect(hashes).toContain(createHash('sha256').update(bytes).digest('hex'));

  // History uses the same file row (link + meta + copy).
  const history = page.getByTestId('export-history-row');
  await expect(history).toHaveCount(1);
  await expect(history.getByTestId('export-file-row')).toHaveCount(files);
  await expect(history.getByTestId('export-file-meta').first()).toHaveText(
    /^\d+(,\d)? (B|KB|MB) · sha256 [0-9a-f]{8}…$/,
  );
  await page.screenshot({ path: '__screenshots__/t250-export-1440.png' });
});

for (const [width, height] of [
  [390, 844],
  [360, 740],
] as const) {
  test(`${width}: "İndir" visible without scrolling; file rows do not break mid-word`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height });
    await toExport(page);
    await inViewport(page, 'export-download');
    await expect(page.getByTestId('export-download')).toBeDisabled();
    // The reason stays readable on phones (in the page, the footer has no room).
    await expect(page.getByText(w.needChecks, { exact: true }).first()).toBeAttached();
    await oneLine(page, 'export-file-meta');
    // The name line is one line too (cut in the middle, never wrapped).
    const names = page.getByTestId('export-file-row').locator('span[title]');
    for (let i = 0; i < (await names.count()); i++) {
      const h = await names.nth(i).evaluate((el) => el.getBoundingClientRect().height);
      expect(h).toBeLessThan(22);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test('import panel: one-sentence intro, apply row visible without scrolling (1440 × 900)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await page.getByRole('button', { name: c.pasteOpen }).click();
  const panel = page.locator('#paste-panel');
  await expect(panel.getByText(c.paste.intro, { exact: true })).toBeVisible();
  await expect(panel.getByText(c.paste.help)).toHaveCount(0);
  await page.getByLabel(c.paste.textLabel).fill(KITCHEN);
  const apply = panel.getByRole('button', { name: c.paste.applyCount.replace('{count}', '5') });
  await expect(apply).toBeEnabled();
  await page.evaluate(() => window.scrollTo(0, 0));
  await inViewport(page, 'import-actions');
  // Above the wizard footer, not behind it.
  const actions = await page.getByTestId('import-actions').boundingBox();
  const footer = await page.getByTestId('wizard-footer').boundingBox();
  expect((actions?.y ?? 0) + (actions?.height ?? 0)).toBeLessThanOrEqual((footer?.y ?? 0) + 0.5);
  await page.screenshot({ path: '__screenshots__/t250-import-1440.png' });
});
