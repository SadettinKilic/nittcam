import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { openNewProject, paste, saved, wizardReady } from './wizard-helpers';

/** B20a tester: control cabinet without templates (T282 no line) + file name path (T283). */
const PART = ['Parça adı\tEn\tBoy\tAdet\tDamar', 'Yan\t396\t716\t1\thayır'].join('\n');

for (const vp of [
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
]) {
  test(`no template: no checklist line, no SABLON comment, name → file name (${vp.width})`, async ({
    page,
  }) => {
    test.setTimeout(vp.width < 600 ? 40_000 : 180_000);
    await page.setViewportSize(vp);
    await openNewProject(page, 'parcalar');
    if (vp.width < 600) {
      // phone: smoke only (D-043); the name field is not shown at 390 (mobile pass)
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
      return;
    }
    const name = page.getByTestId('project-name');
    await name.click();
    await page.keyboard.type('Mutfak alt dolap 60');
    await name.press('Enter');
    await paste(page, PART, 1);
    await saved(page);
    await page.getByTestId('wizard-next').click();
    await wizardReady(page, 'dizilim');
    await page.getByRole('button', { name: tr.cutList.nesting.run, exact: true }).click();
    await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
    await saved(page);
    await page.getByTestId('wizard-next').click();
    await wizardReady(page, 'simulasyon');
    await expect(page.getByTestId('sim-check-status')).toHaveAttribute('data-ok', 'true', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('sim-unverified-templates')).toHaveCount(0);
    await page.getByTestId('wizard-next').click();
    await wizardReady(page, 'export');
    await expect(page.getByTestId('export-status')).toHaveAttribute('data-ok', 'true', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('export-check-templates')).toHaveCount(0);
    for (const k of ['origin', 'tool', 'aircut', 'toolchange']) {
      const c = page.getByTestId(`export-check-${k}`);
      if (await c.count()) await c.check();
    }
    await page.getByTestId('export-accept').check();
    const download = page.getByTestId('export-download');
    await expect(download).toBeEnabled();
    const [d] = await Promise.all([page.waitForEvent('download'), download.click()]);
    expect(d.suggestedFilename()).toMatch(/^Mutfak_alt_dolap_60_r\d+_S1\.tap$/); // T295
    const content = (await readFile(await d.path())).toString('utf8');
    expect(content).not.toContain('SABLON');
    const noScroll = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
    expect(noScroll).toBe(true);
  });
}
