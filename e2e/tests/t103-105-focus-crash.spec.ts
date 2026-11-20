import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import trError from '../../apps/web/messages/tr-error.json' with { type: 'json' };
import { goStep, nest, openNewProject, paste, KITCHEN } from './wizard-helpers';

// B2 fix round 1: focus goes back to the opener of every state-opened overlay (T103), and the
// test-only crash hook (ThrowProbe, NITTCAM_UI_GALLERY=1 server) reaches each error boundary (T105).
const ready = async (page: Page, path = '/') => {
  await page.goto(path);
  await expect(page.getByTestId('shell-topbar')).toBeVisible();
  await page.waitForLoadState('networkidle');
};

test.describe('overlay focus return (T103)', () => {
  test('390 px drawer: the X button gives focus back to "Menüyü aç"', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await ready(page);
    const btn = page.getByRole('button', { name: tr.shell.openMenu });
    await btn.click();
    const drawer = page.getByTestId('shell-drawer');
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: tr.shell.closeMenu }).click();
    await expect(drawer).toBeHidden();
    await expect(btn).toBeFocused();
  });

  test('palette opened from the search button: Escape returns focus to it', async ({ page }) => {
    await ready(page);
    const search = page.getByTestId('palette-open');
    await search.click();
    await expect(page.getByTestId('command-palette')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('command-palette')).toHaveCount(0);
    await expect(search).toBeFocused();
  });

  test('"?" dialog: Escape returns focus to the element that had it', async ({ page }) => {
    await ready(page);
    const link = page.getByRole('link', { name: tr.nav.projects }).first();
    await link.focus();
    await page.keyboard.press('Shift+?');
    const dlg = page.getByTestId('shortcuts-dialog');
    await expect(dlg).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await expect(link).toBeFocused();
  });
});

test.describe('error boundaries via the test crash hook (T105)', () => {
  test('a crashing page shows the app error page inside the shell', async ({ page }) => {
    await ready(page, '/?__throw=page');
    const error = page.getByTestId('page-error');
    await expect(error).toBeVisible();
    await expect(error).toContainText(trError.title);
    await expect(page.getByTestId('shell-topbar')).toBeVisible();
  });

  test('a crashing layout canvas shows the CanvasBoundary fallback', async ({ page }) => {
    await page.addInitScript(() => window.sessionStorage.setItem('__throw', 'canvas'));
    await openNewProject(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    await nest(page);
    const fallback = page.getByTestId('canvas-error');
    await expect(fallback).toBeVisible({ timeout: 20_000 });
    await expect(fallback).toContainText(tr.feedback.canvas.title);
    // The rest of the wizard survives.
    await expect(page.getByTestId('wizard-step-title')).toHaveAttribute('data-step', 'dizilim');
  });

  test('a crashing simulation canvas shows the CanvasBoundary fallback', async ({ page }) => {
    await openNewProject(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    await nest(page);
    await expect(page.getByTestId('layout-canvas')).toBeVisible({ timeout: 20_000 });
    await page.evaluate(() => window.sessionStorage.setItem('__throw', 'canvas'));
    await goStep(page, 'simulasyon');
    const fallback = page.getByTestId('canvas-error');
    await expect(fallback).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('sim-banner')).toBeVisible();
  });
});
