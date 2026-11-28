import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { goStep, openNewProject, pasteAndNest, pickOption } from './wizard-helpers';

// MB3 tester: aluminium shows the D-130 reason on Simülasyon, ACM does not; axe + 390 px smoke.
const m = tr.materials;

async function axe(page: import('@playwright/test').Page) {
  await page.waitForTimeout(500);
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
}

test.describe('MB3 tester', () => {
  for (const width of [1440, 390]) {
    test(`aluminium shows the NC block reason on Simülasyon, axe clean (${width}px)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openNewProject(page, 'makine');
      await pickOption(page.getByTestId('wizard-material'), m.aluminium);
      await expect(await axe(page)).toEqual([]);
      await pasteAndNest(page, undefined, undefined, 'makine');
      await goStep(page, 'simulasyon');
      await expect(
        page.getByText('Alüminyum için rampa giriş', { exact: false }).first(),
      ).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await expect(await axe(page)).toEqual([]);
    });
  }
});
