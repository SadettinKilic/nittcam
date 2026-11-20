import { expect, test, type Page } from '@playwright/test';
import { goStep, openNewProject, pasteAndNest, saved } from './wizard-helpers';

/**
 * Tester (B39 rider): the longest dialog, NC "Yeniden üret" (an AlertDialog on the shared panel)
 * with the D-071 checklist and the acceptance, fits short laptop screens; its confirm button is
 * reachable without scrolling.
 */

async function exportNc(page: Page) {
  await expect(page.getByTestId('export-status')).toHaveAttribute('data-ok', 'true', {
    timeout: 30_000,
  });
  for (const id of [
    'export-check-origin',
    'export-check-tool',
    'export-check-aircut',
    'export-check-toolchange',
    'export-check-templates',
  ]) {
    const box = page.getByTestId(id);
    if (await box.count()) await box.check();
  }
  await page.getByTestId('export-accept').check();
  await page.getByTestId('export-download').click();
  await expect(page.getByTestId('export-ready')).toBeVisible({ timeout: 30_000 });
}

for (const size of [
  { width: 1366, height: 768 },
  { width: 1024, height: 768 },
]) {
  test(`NC re-export dialog fits ${size.width}×${size.height}, confirm reachable`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await openNewProject(page, 'parcalar');
    await pasteAndNest(page);
    await saved(page);
    await goStep(page, 'export');
    await exportNc(page);
    await page.setViewportSize(size);

    await page.getByTestId('export-history-row').first().getByTestId('export-reexport').click();
    const dialog = page.getByTestId('export-reexport-accept');
    await expect(page.getByTestId('reexport-checklist')).toBeVisible();
    await page.waitForFunction(() =>
      document.getAnimations().every((a) => a.playState !== 'running'),
    );
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(size.height);

    for (const id of [
      'reexport-check-origin',
      'reexport-check-tool',
      'reexport-check-aircut',
      'reexport-check-toolchange',
      'reexport-check-templates',
    ]) {
      const b = page.getByTestId(id);
      if (await b.count()) await b.check();
    }
    const accept = page.getByTestId('reexport-accept');
    if (await accept.count()) await accept.check();
    const confirm = page.getByTestId('export-reexport-confirm');
    await expect(confirm).toBeEnabled();
    await expect(confirm).toBeInViewport({ ratio: 1 });
    await confirm.click();
    await expect(dialog).toHaveCount(0);
  });
}
