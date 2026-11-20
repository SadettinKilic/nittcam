import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { applyTheme, expectNoA11yViolations } from './visual/helpers';
import { fill, KITCHEN, paste, wizardReady } from './wizard-helpers';

// B42 tester checks (T184): the first-run tour on empty storage: close button, back, focus
// stays inside, focus trap by Tab, phone smoke, light/dark captures, and the Ayarlar → Genel link.
test.use({ storageState: { cookies: [], origins: [] } });

const t = tr.onboarding;
const SHOTS = '__screenshots__/b42-tester';

async function noPageHScroll(page: Page): Promise<void> {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(over).toBeLessThanOrEqual(1);
}

test.describe('B42 tester: first-run tour', () => {
  test('the X button closes the tour and it stays closed after reload', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const dialog = page.getByTestId('onboarding-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: t.close }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(dialog).toBeHidden();
  });

  test('back returns a page; Tab and Shift+Tab never leave the dialog', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const dialog = page.getByTestId('onboarding-dialog');
    await expect(dialog).toHaveAttribute('data-page', 'welcome');
    await expect(page.getByTestId('onboarding-back')).toHaveCount(0);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveAttribute('data-page', 'start');
    await expect(page.getByTestId('onboarding-progress')).toHaveText('Adım 3 / 3');
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    }
    await page.getByTestId('onboarding-back').focus();
    await page.keyboard.press('Space');
    await expect(dialog).toHaveAttribute('data-page', 'steps');
    await page.getByTestId('onboarding-skip').focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
  });

  for (const theme of ['light', 'dark'] as const) {
    test(`captures at 1440 (${theme}) and axe on every page`, async ({ page }) => {
      await applyTheme(page, theme);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto('/');
      const dialog = page.getByTestId('onboarding-dialog');
      for (const name of ['welcome', 'steps', 'start']) {
        await expect(dialog).toHaveAttribute('data-page', name);
        await expectNoA11yViolations(page);
        await page.screenshot({ path: `${SHOTS}/tour-${name}-1440-${theme}.png` });
        if (name !== 'start') await page.getByTestId('onboarding-next').click();
      }
    });
  }

  test('390 px smoke: no page scroll sideways, sample button reachable, axe clean', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByTestId('onboarding-next').click();
    await page.getByTestId('onboarding-next').click();
    await expect(page.getByTestId('onboarding-sample')).toBeInViewport();
    await noPageHScroll(page);
    await expectNoA11yViolations(page);
    await page.screenshot({ path: `${SHOTS}/tour-start-390-light.png` });
  });

  test('cut list (T185): Tab past the last cell and Shift+Tab before the first leave the grid', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.getByTestId('onboarding-skip').click();
    await page.goto('/projeler/yeni?adim=parcalar');
    await wizardReady(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    const grid = page.getByTestId('cut-list-grid');
    const inGrid = () => grid.evaluate((g) => g.contains(document.activeElement));
    const cell = (n: number, column: string) =>
      page.getByLabel(fill(tr.cutList.cellLabel, { n, column }), { exact: true });
    // A trap kept focus in the grid forever; in-grid controls (row checkbox, menu, ~12 header sort buttons) are fine.
    async function leaves(start: ReturnType<typeof cell>, key: 'Tab' | 'Shift+Tab') {
      await start.focus();
      for (let i = 0; i < 20; i++) {
        await page.keyboard.press(key);
        if (!(await inGrid())) return true;
      }
      return false;
    }
    expect(await leaves(cell(1, tr.cutList.columns.name), 'Shift+Tab')).toBe(true);
    expect(await leaves(cell(5, tr.cutList.columns.note), 'Tab')).toBe(true);
  });

  test('Ayarlar → Genel holds the reopen card', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.getByTestId('onboarding-skip').click();
    await page.goto('/ayarlar');
    await expect(
      page.getByRole('link', { name: tr.settings.nav.general, exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('onboarding-reopen')).toBeVisible();
    await page.getByTestId('onboarding-reopen').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/ayarlar-genel-1440-light.png`, fullPage: true });
    await page.goto('/ayarlar/malzemeler');
    await expect(page.getByTestId('onboarding-reopen')).toHaveCount(0);
  });
});
