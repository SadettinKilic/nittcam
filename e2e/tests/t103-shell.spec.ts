import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };

// T103: app shell behaviour (sidebar, top bar, drawer, skip link, keyboard).
const menu = (page: Page) => page.getByRole('navigation', { name: tr.nav.label });

test.describe('app shell', () => {
  test('sidebar shows company, operator and the menu with an active item', async ({ page }) => {
    await page.goto('/makineler');
    const sidebar = page.getByTestId('shell-sidebar');
    await expect(sidebar.getByTestId('shell-company')).toHaveText('Atölyem');
    await expect(sidebar.getByTestId('shell-operator')).toHaveText(tr.shell.operator);
    const nav = page.getByRole('navigation', { name: tr.nav.label });
    await expect(nav.getByRole('link', { name: tr.nav.machines })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(page.getByTestId('shell-title')).toHaveText(tr.nav.machines);
  });

  test('brand logo top-left links home; the workspace row sits at the bottom (T194)', async ({
    page,
  }) => {
    await page.goto('/makineler');
    const sidebar = page.getByTestId('shell-sidebar');
    const brand = sidebar.getByRole('link', { name: tr.shell.brandHome });
    await expect(brand).toBeVisible();
    const top = async (l: ReturnType<Page['getByTestId']>) =>
      (await l.boundingBox())?.y ?? Number.NaN;
    const brandY = await top(brand);
    const rowY = await top(sidebar.getByTestId('shell-workspace'));
    expect(brandY).toBeLessThan(20);
    expect(rowY).toBeGreaterThan(brandY + 300);
    expect(rowY).toBeLessThan(await top(page.getByTestId('sidebar-toggle')));
    await brand.click();
    await expect(page).toHaveURL(/\/$/);
    // Collapsed rail: mark only.
    await page.getByTestId('sidebar-toggle').click();
    await expect(sidebar.getByTestId('brand-logo').first()).toBeHidden();
    await expect(sidebar.locator('[data-testid=brand-logo]:visible')).toHaveCount(1);
    await expect(sidebar.locator('[data-testid=brand-logo]:visible')).not.toContainText('Nitt');
    await page.getByTestId('sidebar-toggle').click();
  });

  test('favicon, app icons, theme colour and page titles (T194)', async ({ page, request }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(`${tr.nav.home} · NittCam`);
    const icons = await page
      .locator('link[rel=icon]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('href') ?? ''));
    expect(icons.some((h) => h.includes('icon.svg'))).toBe(true);
    await expect(page.locator('link[rel=apple-touch-icon]')).toHaveCount(1);
    await expect(page.locator('meta[name=theme-color]')).toHaveCount(2);
    for (const href of [...icons, '/brand/icon-512-light.png', '/manifest.webmanifest']) {
      expect((await request.get(href)).ok(), href).toBe(true);
    }
    await page.goto('/makineler');
    await expect(page).toHaveTitle(`${tr.machines.title} · NittCam`);
  });

  test('breadcrumb links back to the parent page', async ({ page }) => {
    await page.goto('/projeler/yeni');
    await expect(page.getByTestId('wizard-step-title')).toBeVisible({ timeout: 30_000 });
    const crumbs = page.getByRole('navigation', { name: tr.shell.breadcrumb });
    await expect(crumbs.getByTestId('shell-title')).toHaveText(tr.shell.crumbs.newProject);
    await crumbs.getByRole('link', { name: tr.nav.projects }).click();
    await expect(page).toHaveURL(/\/projeler$/);
    await expect(page.getByTestId('shell-title')).toHaveText(tr.nav.projects);
  });

  test('skip link is the first tab stop and moves focus to the content', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: tr.shell.skipToContent });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('#content')).toBeFocused();
  });

  test('menu works with the keyboard', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab'); // skip link
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: tr.shell.brandHome })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('nav-new-project')).toBeFocused();
    await page.keyboard.press('Tab'); // Ana sayfa
    await page.keyboard.press('Tab'); // Makineler
    await expect(menu(page).getByRole('link', { name: tr.nav.machines })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/makineler$/);
  });

  test('collapsed state survives a reload', async ({ page }) => {
    await page.goto('/');
    const toggle = page.getByTestId('sidebar-toggle');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-sidebar', 'collapsed');
    await expect
      .poll(() => page.getByTestId('shell-sidebar').evaluate((el) => el.clientWidth))
      .toBeLessThanOrEqual(64);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-sidebar', 'collapsed');
    await expect(page.getByTestId('sidebar-toggle')).toHaveAttribute('aria-expanded', 'false');
    // Labels stay available to screen readers and the links still work.
    await menu(page).getByRole('link', { name: tr.nav.projects }).click();
    await expect(page).toHaveURL(/\/projeler$/);
    await page.getByTestId('sidebar-toggle').click();
    await expect(page.locator('html')).not.toHaveAttribute('data-sidebar', 'collapsed');
  });

  test.describe('390 px', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('the menu is a drawer that closes after navigating', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByTestId('shell-sidebar')).toBeHidden();
      await expect(page.getByTestId('shell-brand-mobile')).toBeVisible();
      await page.getByRole('button', { name: tr.shell.openMenu }).click();
      const drawer = page.getByTestId('shell-drawer');
      await expect(drawer).toBeVisible();
      await expect(drawer.getByRole('link', { name: tr.shell.brandHome })).toBeVisible();
      await expect(drawer.getByTestId('shell-company')).toBeVisible();
      await drawer.getByRole('link', { name: tr.nav.projects }).click();
      await expect(page).toHaveURL(/\/projeler$/);
      await expect(drawer).toBeHidden();
    });

    test('no page scrolls sideways', async ({ page }) => {
      for (const path of ['/', '/projeler', '/makineler', '/projeler/yeni']) {
        await page.goto(path);
        await expect(page.getByTestId('shell-topbar')).toBeVisible();
        await page.waitForLoadState('networkidle');
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, path).toBeLessThanOrEqual(0);
      }
    });
  });
});
