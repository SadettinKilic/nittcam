import { expect, test } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { openNewProject } from './wizard-helpers';

// T195: self-hosted mono, type scale, Measure, compact density; T194 brand in the gallery.
const t = tr.devUi;

test.describe('T195 typography', () => {
  test('mono font is self-hosted, used for code and renders Turkish capitals', async ({ page }) => {
    const external: string[] = [];
    page.on('request', (r) => {
      if (/fonts\.(googleapis|gstatic)\.com/.test(r.url())) external.push(r.url());
    });
    await page.goto('/dev/ui');
    await expect(page.getByRole('heading', { level: 1, name: t.title })).toBeVisible();
    const mono = page.getByTestId('gallery-mono');
    await expect(mono).toBeVisible();
    const family = await mono.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(family).toMatch(/JetBrains Mono/);
    expect(family).not.toMatch(/consolas|courier/i);
    const ok = await page.evaluate(async () => {
      await document.fonts.ready;
      const el = document.querySelector('[data-testid=gallery-mono]');
      const fam = el ? (getComputedStyle(el).fontFamily.split(',')[0] ?? '').trim() : '';
      await document.fonts.load(`14px ${fam}`, 'İıŞşĞğ');
      return document.fonts.check(`14px ${fam}`, 'İıŞşĞğÜüÖöÇç');
    });
    expect(ok).toBe(true);
    expect(external).toEqual([]);
  });

  test('gallery shows both densities: 40/36 px rows, 40/32 px controls', async ({ page }) => {
    await page.goto('/dev/ui');
    const height = async (scope: string, selector: string) =>
      page
        .getByTestId(`density-${scope}`)
        .locator(selector)
        .first()
        .evaluate((el) => el.getBoundingClientRect().height);
    expect(await height('comfortable', '.h-row')).toBe(40);
    expect(await height('compact', '.h-row')).toBe(36);
    expect(await height('comfortable', 'button')).toBe(40);
    expect(await height('compact', 'button')).toBe(32);
  });

  test('page titles are 24 px on desktop', async ({ page }) => {
    await page.goto('/makineler');
    const size = await page
      .getByRole('heading', { level: 1 })
      .evaluate((el) => getComputedStyle(el).fontSize);
    expect(size).toBe('24px');
  });

  test('the wizard writes the step name once: the H1 is the stepper title', async ({ page }) => {
    await openNewProject(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByTestId('wizard-step-title')).toHaveText(tr.wizard.steps.makine);
    // The active step's own label is for screen readers only (no visible duplicate).
    await expect(
      page.getByTestId('wizard-step-makine').getByText(tr.wizard.steps.makine, { exact: true }),
    ).toHaveClass(/sr-only/);
  });

  test.describe('390 px', () => {
    test.use({ viewport: { width: 390, height: 844 } });
    test('page titles are 20 px on phones', async ({ page }) => {
      await page.goto('/makineler');
      const size = await page
        .getByRole('heading', { level: 1 })
        .evaluate((el) => getComputedStyle(el).fontSize);
      expect(size).toBe('20px');
    });
  });
});
