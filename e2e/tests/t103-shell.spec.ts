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
    // Collapsed rail: short wordmark "NC" only (T194b).
    await page.getByTestId('sidebar-toggle').click();
    await expect(sidebar.getByTestId('brand-wordmark').first()).toBeHidden();
    await expect(sidebar.locator('[data-testid=brand-wordmark]:visible')).toHaveCount(1);
    await expect(sidebar.locator('[data-testid=brand-wordmark]:visible')).not.toContainText('Nitt');
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

  test('declutter: live items first, Yakında group last, one accent Yeni proje (T194a)', async ({
    page,
  }) => {
    await page.goto('/');
    const nav = menu(page);
    await expect(nav.getByRole('link')).toHaveText([
      tr.nav.home,
      tr.nav.machines,
      tr.nav.projects,
      tr.nav.templates,
      tr.nav.settings,
    ]);
    // T151: Şablonlar is live too, so the Yakında group is gone.
    await expect(page.getByTestId('nav-soon')).toHaveCount(0);
    // Exactly one accent-filled "Yeni proje" at 1440 px: the sidebar button.
    const accent = page
      .getByRole('link', { name: tr.nav.newProject, exact: true })
      .filter({ visible: true })
      .and(page.locator('.bg-accent'));
    await expect(accent).toHaveCount(1);
    await expect(accent).toHaveAttribute('data-testid', 'nav-new-project');
  });

  test('a new project is "Adsız proje…" with the name focused and selected (T194a)', async ({
    page,
  }) => {
    await page.goto('/projeler/yeni');
    await expect(page.getByTestId('wizard-step-title')).toBeVisible({ timeout: 30_000 });
    const name = page.getByTestId('project-name');
    await expect(name).toHaveValue(new RegExp(`^${tr.wizard.defaultName}( \\d+)?$`));
    await expect(name).toBeFocused();
    const selected = await name.evaluate((el: HTMLInputElement) =>
      el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0),
    );
    expect(selected).toBe(await name.inputValue());
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
      await expect(page.getByTestId('shell-brand-mobile')).toContainText('NittCAM');
      // Below 768 px the sidebar is a drawer, so the page keeps its own "Yeni proje".
      await expect(page.getByTestId('home-new-project').filter({ visible: true })).toBeVisible();
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
