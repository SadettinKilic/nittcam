import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };

/**
 * T183: Ayarlar → Görünüm. Theme, density, 3D simple mode and the motion override apply at once
 * and stay after a reload (localStorage + the <html> attributes set before paint).
 */
const a = tr.settings.appearance;

async function axeClean(page: Page, include: string) {
  const res = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .include(include)
    .analyze();
  const bad = res.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
  expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
}

test('appearance preferences apply at once and persist across a reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/ayarlar');
  await page
    .getByTestId('settings-nav')
    .getByRole('link', { name: tr.settings.nav.appearance })
    .click();
  await expect(page).toHaveURL(/\/ayarlar\/gorunum$/);
  await expect(page.getByRole('heading', { level: 1, name: a.title })).toBeVisible();
  await expect(
    page.getByTestId('settings-nav').getByRole('link', { name: tr.settings.nav.appearance }),
  ).toHaveAttribute('aria-current', 'page');

  const html = page.locator('html');
  await expect(html).not.toHaveAttribute('data-density', /.*/);
  await expect(page.getByTestId('density-comfortable')).toHaveAttribute('data-state', 'checked');

  // Density: compact tightens the control height right away.
  const before = await page
    .getByTestId('appearance-reduce-motion')
    .evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--spacing-control-md').trim(),
    );
  await page.getByTestId('density-compact').click();
  await expect(html).toHaveAttribute('data-density', 'compact');
  const after = await html.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--spacing-control-md').trim(),
  );
  expect(before).toBe('2.5rem');
  expect(after).toBe('2rem');

  // Theme, 3D simple mode, motion override.
  await page
    .getByTestId('settings-appearance')
    .getByRole('radio', { name: tr.shell.theme.dark })
    .click();
  await expect(html).toHaveClass(/\bdark\b/);
  await page.getByTestId('appearance-simple3d').click();
  await expect(page.getByTestId('appearance-simple3d')).toHaveAttribute('data-state', 'checked');
  await page.getByTestId('appearance-reduce-motion').click();
  await expect(html).toHaveAttribute('data-motion', 'reduce');

  // Shortcut list: every registered group, with the palette shortcut.
  await expect(page.getByTestId('settings-shortcut-palette')).toContainText(
    tr.shortcuts.items.palette,
  );
  await axeClean(page, '[data-testid="settings-appearance"]');

  await page.reload();
  await expect(html).toHaveAttribute('data-density', 'compact');
  await expect(html).toHaveAttribute('data-motion', 'reduce');
  await expect(html).toHaveClass(/\bdark\b/);
  await expect(page.getByTestId('density-compact')).toHaveAttribute('data-state', 'checked');
  await expect(page.getByTestId('appearance-simple3d')).toHaveAttribute('data-state', 'checked');
  await expect(page.getByTestId('appearance-reduce-motion')).toHaveAttribute(
    'data-state',
    'checked',
  );
  // The motion override really cuts transitions.
  const duration = await page
    .getByTestId('appearance-simple3d')
    .evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(parseFloat(duration)).toBeLessThan(0.01);

  // Back to the defaults: attributes leave <html>.
  await page.getByTestId('density-comfortable').click();
  await page.getByTestId('appearance-reduce-motion').click();
  await page.getByTestId('appearance-simple3d').click();
  await page
    .getByTestId('settings-appearance')
    .getByRole('radio', { name: tr.shell.theme.system })
    .click();
  await expect(html).not.toHaveAttribute('data-density', /.*/);
  await expect(html).not.toHaveAttribute('data-motion', /.*/);
  await page.reload();
  await expect(page.getByTestId('density-comfortable')).toHaveAttribute('data-state', 'checked');
  await expect(page.getByTestId('appearance-simple3d')).toHaveAttribute('data-state', 'unchecked');
});

test('appearance page fits a phone without horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/ayarlar/gorunum');
  await expect(page.getByTestId('appearance-density')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await axeClean(page, '[data-testid="settings-appearance"]');
});
