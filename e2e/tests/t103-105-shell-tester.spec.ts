import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { expectNoA11yViolations } from './visual/helpers';

// B2 tester: keyboard-only shell, palette folding, shortcut guards, layout shift, axe, error page.
const palette = (page: Page) => page.getByTestId('command-palette');
const ready = async (page: Page, path = '/') => {
  await page.goto(path);
  await expect(page.getByTestId('shell-topbar')).toBeVisible();
  await page.waitForLoadState('networkidle');
};
const proj = (n: number) => ({
  id: `p-${n}`,
  name: `Proje numara ${n}`,
  status: 'draft',
  revision: 1,
  updatedAt: `2026-11-${String(10 + (n % 15)).padStart(2, '0')}T10:00:00Z`,
  machine: 'Örnek router',
  material: 'mdf',
  thickness: 18,
  sheet: { width: 2800, height: 2070 },
  pieces: 4,
  lastExport: null,
});

test.describe('B2 tester: palette', () => {
  test('dotless i and s-cedilla fold: makıne, olustur; no match gives no options', async ({
    page,
  }) => {
    await ready(page);
    await page.keyboard.press('Control+k');
    const input = page.getByPlaceholder(tr.palette.placeholder);
    await input.fill('makıne');
    await expect(palette(page).getByRole('option').first()).toContainText(tr.nav.machines);
    await input.fill('olustur');
    await expect(palette(page).getByRole('option').first()).toBeVisible();
    await input.fill('zzzqqq');
    await expect(palette(page).getByRole('option')).toHaveCount(0);
  });

  test('arrow keys move the selection, Escape closes', async ({ page }) => {
    await ready(page);
    await page.keyboard.press('Control+k');
    const opts = palette(page).getByRole('option');
    await expect(opts.first()).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(opts.nth(1)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowUp');
    await expect(opts.first()).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Escape');
    await expect(palette(page)).toHaveCount(0);
  });

  test('recent projects: 0 projects shows none, many shows a bounded list', async ({ page }) => {
    await page.route('**/api/projects', (r) => r.fulfill({ json: [] }));
    await ready(page);
    await page.keyboard.press('Control+k');
    await expect(palette(page)).toBeVisible();
    await expect(palette(page).getByTestId('palette-recent')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.unroute('**/api/projects');
    await page.route('**/api/projects', (r) =>
      r.fulfill({ json: Array.from({ length: 60 }, (_, i) => proj(i + 1)) }),
    );
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.keyboard.press('Control+k');
    // The palette fetches the projects when it opens: wait for the list before counting.
    await expect(palette(page).getByTestId('palette-recent').first()).toBeVisible();
    const n = await palette(page).getByTestId('palette-recent').count();
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(10);
  });
});

test.describe('B2 tester: shortcuts never fire while typing', () => {
  test('NumberInput: gp, ?, T do nothing', async ({ page }) => {
    await page.goto('/dev/ui');
    const width = page.getByRole('spinbutton', { name: tr.devUi.number.width });
    await width.click();
    const theme = await page.locator('html').getAttribute('class');
    await page.keyboard.type('gp?T');
    await expect(page).toHaveURL(/\/dev\/ui/);
    await expect(page.getByTestId('shortcuts-dialog')).toHaveCount(0);
    expect(await page.locator('html').getAttribute('class')).toBe(theme);
  });

  test('textarea: typing g m ? stays in the field', async ({ page }) => {
    await page.goto('/projeler/yeni');
    await expect(page.getByTestId('wizard-step-title')).toBeVisible({ timeout: 30_000 });
    const ta = page.locator('textarea').first();
    test.skip((await ta.count()) === 0, 'no textarea in step 1');
    await ta.click();
    await page.keyboard.type('gm?');
    await expect(page).toHaveURL(/\/projeler\/yeni/);
    await expect(page.getByTestId('shortcuts-dialog')).toHaveCount(0);
  });
});

test.describe('B2 tester: layout and a11y', () => {
  test('collapsed sidebar: content x-position never differs while reloading (no shift)', async ({
    page,
  }) => {
    await ready(page, '/makineler');
    await page.getByTestId('sidebar-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-sidebar', 'collapsed');
    await page.waitForTimeout(600);
    const x1 = await page.locator('#content').evaluate((e) => e.getBoundingClientRect().x);
    await page.addInitScript(() => {
      const w = window as unknown as { __xs: number[] };
      w.__xs = [];
      const sample = () => {
        const c = document.querySelector('#content');
        if (c) w.__xs.push(c.getBoundingClientRect().x);
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.reload();
    await page.waitForLoadState('networkidle');
    const xs = await page.evaluate(() => (window as unknown as { __xs: number[] }).__xs);
    expect(xs.length).toBeGreaterThan(0);
    for (const x of xs) expect(x).toBe(x1);
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`axe on the shell (${scheme}), desktop and 390 px`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      for (const size of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(size);
        await ready(page, '/makineler');
        await expectNoA11yViolations(page, {
          include: '[data-testid="shell-topbar"], [data-testid="shell-sidebar"]',
        });
      }
    });
  }

  test('390 px drawer: focus trapped, Escape closes and returns focus', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await ready(page);
    const btn = page.getByRole('button', { name: tr.shell.openMenu });
    await btn.focus();
    await page.keyboard.press('Enter');
    const drawer = page.getByTestId('shell-drawer');
    await expect(drawer).toBeVisible();
    for (const key of ['Tab', 'Shift+Tab']) {
      for (let i = 0; i < 14; i++) {
        await page.keyboard.press(key);
        expect(await drawer.evaluate((d) => d.contains(document.activeElement))).toBe(true);
      }
    }
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();
    await expect(btn).toBeFocused();
  });

  test('"?" dialog opens, traps focus, Escape closes', async ({ page }) => {
    await ready(page);
    await page.keyboard.press('Shift+?');
    const dlg = page.getByTestId('shortcuts-dialog');
    await expect(dlg).toBeVisible();
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      expect(await dlg.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
  });
});

test.describe('B2 tester: feedback', () => {
  test('a malformed API answer keeps the shell and shows an error state', async ({ page }) => {
    await page.route('**/api/projects', (r) => r.fulfill({ json: { not: 'an array' } }));
    await page.goto('/projeler');
    const err = page.getByTestId('page-error').or(page.getByTestId('projects-error'));
    await expect(err.first()).toBeVisible();
    await expect(page.getByTestId('shell-sidebar')).toBeVisible();
  });

  test('toasts live in an aria-live region', async ({ page }) => {
    await page.route('**/api/projects', (r) => r.fulfill({ json: [proj(1)] }));
    await page.route('**/api/projects/p-1/copy', (r) => r.fulfill({ status: 500, json: {} }));
    await page.goto('/projeler');
    const row = page.getByTestId('project-row').first();
    await row.getByRole('button', { name: new RegExp(tr.projects.copy) }).click();
    await expect(page.locator('[data-sonner-toast]').first()).toBeVisible();
    await expect(page.locator('[aria-live]').first()).toBeAttached();
  });
});
