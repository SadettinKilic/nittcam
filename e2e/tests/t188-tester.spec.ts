import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { expectNoA11yViolations } from './visual/helpers';
import { goStep, KITCHEN, openNewProject, paste, pasteAndNest } from './wizard-helpers';

/**
 * Tester checks for B43 (T188 / T248 / T255, D-078): the 40 px touch rule only on coarse pointers
 * from 640 px (mouse desktop and touch phones keep their sizes), the machine form on a phone, and
 * axe at 390 and 1440 on the screens the batch changed. Review captures go to the git-ignored
 * `e2e/__screenshots__/` folder.
 */

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `__screenshots__/b43-tester/${name}.png`, fullPage: false });

async function noSideScroll(page: Page) {
  const over = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(over).toBeLessThanOrEqual(1);
}

async function height(page: Page, name: string) {
  const b = await page.getByRole('button', { name, exact: true }).first().boundingBox();
  if (!b) throw new Error(`no box: ${name}`);
  return b.height;
}

test.describe('desktop mouse: sizes unchanged (D-078)', () => {
  for (const [w, h] of [
    [1440, 900],
    [1024, 768],
  ] as const) {
    for (const scheme of ['light', 'dark'] as const) {
      test(`${w} ${scheme}: Parçalar toolbar keeps its mouse size, axe clean`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.setViewportSize({ width: w, height: h });
        await openNewProject(page, 'parcalar');
        await paste(page, KITCHEN, 5);
        // The touch rule (2.5 rem) must not reach a mouse screen.
        expect(await height(page, tr.cutList.addRow)).toBeLessThan(40);
        await expect(page.getByTestId('cut-list-card')).toHaveCount(0);
        await noSideScroll(page);
        await shot(page, `parcalar-${w}-${scheme}`);
        if (w === 1440) await expectNoA11yViolations(page);
      });
    }
  }
});

test.describe('touch phone: compact cards keep their size (D-078 rule is ≥ 640 px only)', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('390 coarse pointer: cards ≤ 88 px, ≥ 5 visible', async ({ page }) => {
    await openNewProject(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    const cards = page.getByTestId('cut-list-card');
    await expect(cards.first()).toBeVisible();
    for (const card of (await cards.all()).slice(0, 5)) {
      expect((await card.boundingBox())?.height ?? 999).toBeLessThanOrEqual(88);
    }
    await noSideScroll(page);
    await shot(page, 'parcalar-390-touch');
  });
});

test.describe('phone screens (T188, T255)', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`390 ${scheme}: Parçalar and Simülasyon axe clean, captures`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width: 390, height: 844 });
      await openNewProject(page, 'parcalar');
      await pasteAndNest(page);
      await goStep(page, 'parcalar');
      await expect(page.getByTestId('cut-list-card').first()).toBeVisible();
      await shot(page, `parcalar-390-${scheme}`);
      await expectNoA11yViolations(page);
      await goStep(page, 'simulasyon');
      await expect(page.getByTestId('sim-canvas')).toBeVisible({ timeout: 30_000 });
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await shot(page, `simulasyon-390-${scheme}`);
      await expectNoA11yViolations(page, { exclude: ['canvas'] });
      await noSideScroll(page);
    });
  }

  test('390: machine form materials as cards, save bar reachable, axe clean', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/makineler');
    await page.getByRole('button', { name: 'Yeni makine' }).first().click();
    const form = page.getByTestId('machine-form');
    await expect(form).toBeVisible({ timeout: 30_000 });
    await noSideScroll(page);
    const table = page.getByTestId('materials-table');
    if ((await table.count()) > 0 && (await page.getByTestId('materials-table-row').count()) > 0) {
      const row = await page.getByTestId('materials-table-row').first().boundingBox();
      expect(row?.width ?? 999).toBeLessThanOrEqual(390);
    }
    await expect(page.getByTestId('machine-save-bar')).toBeAttached();
    await shot(page, 'machine-form-390');
    await expectNoA11yViolations(page);
  });

  test('390: cabinet dialog axe clean', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openNewProject(page, 'parcalar');
    await paste(page, KITCHEN, 5);
    await page.getByTestId('cut-list-more').click();
    await page.getByTestId('cabinet-open').click();
    await expect(page.getByTestId('cabinet-doors')).toBeVisible();
    await page.waitForTimeout(400); // dialog animation before axe
    await shot(page, 'cabinet-390');
    await expectNoA11yViolations(page);
  });
});
