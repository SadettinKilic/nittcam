import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { STEP_KEYS, goStep, openNewProject, pasteAndNest } from './wizard-helpers';

/**
 * T199 tester: one "Profil doğrulanmadı" chip on every wizard step (keyboard-reachable popover with
 * the full sentence, the reasons and the Doğrulama link), and the export safety rule unchanged: an
 * unverified profile never downloads without the acknowledgement, in the UI or through the API.
 */
test.describe('T199 tester: notice hierarchy', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('one chip per step; popover by keyboard; axe clean with it open', async ({ page }) => {
    await openNewProject(page, 'parcalar');
    await pasteAndNest(page);
    for (const step of STEP_KEYS) {
      await goStep(page, step);
      await expect(page.getByTestId('profile-status-chip').filter({ visible: true })).toHaveCount(
        1,
      );
    }

    const chip = page.getByTestId('profile-status-chip').filter({ visible: true });
    await expect(chip).toContainText(tr.wizard.profileStatus.chip);
    await chip.focus();
    await page.keyboard.press('Enter');
    const detail = page.getByTestId('profile-status-detail');
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(tr.wizard.machine.unverified);
    await expect(detail.locator('li').first()).toBeVisible();
    const link = detail.getByRole('link', { name: tr.wizard.profileStatus.verify });
    await expect(link).toHaveAttribute('href', /\/makineler\/[^/]+\/dogrulama$/);

    const res = await new AxeBuilder({ page }).analyze();
    expect(
      res.violations
        .filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))
        .map((v) => v.id),
    ).toEqual([]);

    await page.keyboard.press('Escape');
    await expect(detail).toBeHidden();
    await expect(chip).toBeFocused();
  });

  test('export: download stays blocked without the acknowledgement (UI and API)', async ({
    page,
  }) => {
    const w = tr.wizard.export;
    await openNewProject(page, 'parcalar');
    await pasteAndNest(page);
    await goStep(page, 'export');
    await expect(page.getByTestId('export-status')).toHaveAttribute('data-ok', 'true', {
      timeout: 30_000,
    });
    const download = page.getByTestId('export-download');
    const accept = page.getByTestId('export-accept');
    await page.getByTestId('export-check-origin').check();
    await page.getByTestId('export-check-tool').check();
    await page.getByTestId('export-check-aircut').check();
    await expect(page.getByTestId('export-unverified')).toBeVisible();
    await expect(page.getByTestId('export-unverified')).toContainText(w.unverifiedTitle);
    await expect(download).toBeDisabled();
    await expect(page.getByTestId('export-hint')).toHaveText(w.needAccept);

    // Ticking and un-ticking the acknowledgement re-blocks the download.
    await accept.check();
    await expect(download).toBeEnabled();
    await accept.uncheck();
    await expect(download).toBeDisabled();
    await expect(page.getByTestId('export-hint')).toHaveText(w.needAccept);

    // Forcing the disabled button does nothing: no export request leaves the page.
    let posted = false;
    page.on('request', (r) => {
      if (r.method() === 'POST' && /\/export$/.test(new URL(r.url()).pathname)) posted = true;
    });
    await download.click({ force: true }).catch(() => undefined);
    await page.waitForTimeout(500);
    expect(posted).toBe(false);

    // The server refuses without the flag and with a non-true flag.
    const m = /\/projeler\/([0-9a-f-]{36})/.exec(page.url());
    expect(m?.[1]).toBeTruthy();
    const api = `/api/projects/${m?.[1]}/export`;
    const revision = Number(await page.getByTestId('save-status').getAttribute('data-revision'));
    expect(revision).toBeGreaterThan(0);
    // T297 (D-072): the checklist is confirmed; the acceptance alone is refused here.
    const refused = await page.request.post(api, { data: { revision, checklistConfirmed: true } });
    expect(refused.status()).toBe(428);
    const refusedFalse = await page.request.post(api, {
      data: { revision, acceptUnverified: false, checklistConfirmed: true },
    });
    expect(refusedFalse.status()).toBe(428);
    // A truthy non-boolean is a bad request, never an acceptance.
    const refusedString = await page.request.post(api, {
      data: { revision, acceptUnverified: 'true', checklistConfirmed: true },
    });
    expect(refusedString.status()).toBe(400);
  });
});
