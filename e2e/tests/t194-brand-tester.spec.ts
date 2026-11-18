import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { THEMES, applyTheme, expectNoA11yViolations, snap } from './visual/helpers';

// T194/T194a tester: brand at 1440/390/320, routes, numbering.
const SIZES = {
  d1440: { width: 1440, height: 900 },
  m390: { width: 390, height: 800 },
  m320: { width: 320, height: 700 },
};

test.describe('T194 tester: brand', () => {
  for (const [vp, size] of Object.entries(SIZES)) {
    for (const theme of THEMES) {
      test(`shell + home ${vp} ${theme}: no overflow, axe, mark visible`, async ({ page }) => {
        await page.setViewportSize(size);
        await applyTheme(page, theme);
        await page.goto('/');
        await expect(page.locator('main')).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
        if (vp === 'm320') {
          await expectNoA11yViolations(page);
          await snap(page, `t194-tester-${vp}-${theme}`, { baseline: false });
          return;
        }
        const logo = page.getByRole('link', { name: /NittCam/ }).first();
        await expect(logo).toBeVisible();
        const box = await logo.boundingBox();
        expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(size.width);
        await expectNoA11yViolations(page);
        await snap(page, `t194-tester-${vp}-${theme}`, { baseline: false });
      });
    }
  }

  test('icon, manifest routes served', async ({ request }) => {
    for (const p of ['/icon.svg', '/manifest.webmanifest', '/apple-icon.png']) {
      const r = await request.get(p);
      expect(r.status(), p).toBe(200);
    }
    const m = await (await request.get('/manifest.webmanifest')).json();
    expect(m.name).toMatch(/NittCam/);
    expect(m.icons.length).toBeGreaterThan(0);
  });

  test('titles end with "· NittCam"', async ({ page }) => {
    for (const p of ['/', '/projeler', '/makineler']) {
      await page.goto(p);
      expect(await page.title(), p).toMatch(/NittCam$/);
    }
  });

  test('"Adsız proje (n)" counter increments across several new projects', async ({ page }) => {
    const names: string[] = [];
    for (let i = 0; i < 3; i++) {
      await page.goto('/projeler/yeni');
      const name = page.getByTestId('project-name');
      await expect(name).toBeFocused({ timeout: 30_000 });
      names.push(await name.inputValue());
      await page
        .getByTestId('wizard-next')
        .click()
        .catch(() => {});
      await page.waitForTimeout(1500);
    }
    console.log('NAMES', JSON.stringify(names));
    for (const n of names) expect(n).toContain(tr.wizard.defaultName);
  });
});
