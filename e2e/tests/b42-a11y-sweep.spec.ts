import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { applyTheme, THEMES } from './visual/helpers';
import { KITCHEN, pasteAndNest, projectId, saved, wizardReady } from './wizard-helpers';

// T185 (spec §3.7, §11): zero serious/critical axe violations on every route, light and dark,
// on a project that has a layout (every wizard step has content).

test.describe.configure({ mode: 'serial' });

let pid = '';
let mid = '';

async function blocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map(
      (v) =>
        `[${v.impact}] ${v.id}: ` +
        v.nodes
          .slice(0, 4)
          .map((n) => n.target.join(' '))
          .join(' | '),
    );
}

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('/projeler/yeni?adim=parcalar');
  await wizardReady(page, 'parcalar');
  await pasteAndNest(page, KITCHEN, 5);
  pid = await projectId(page);
  await saved(page);
  const machines = (await (await page.request.get('/api/machines')).json()) as { id: string }[];
  mid = machines[0]?.id ?? '';
  await page.close();
});

const RUNS = [
  ...THEMES.map((theme) => ({ theme, width: 1440, height: 900 })),
  // Phones must not break (D-043): one light pass at 390 px.
  { theme: 'light' as const, width: 390, height: 844 },
];

for (const { theme, width, height } of RUNS) {
  test(`every route has no serious/critical axe violations (${theme}, ${width} px)`, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width, height });
    await applyTheme(page, theme);
    const routes = [
      '/',
      '/projeler',
      '/projeler?sekme=silinenler',
      '/projeler?sekme=artik',
      '/projeler/yeni',
      ...['makine', 'parcalar', 'dizilim', 'simulasyon', 'export'].map(
        (s) => `/projeler/${pid}?adim=${s}`,
      ),
      `/projeler/${pid}?adim=parcalar&gorunum=cizim`,
      '/makineler',
      `/makineler/${mid}/dogrulama`,
      '/ayarlar/malzemeler',
      '/sablonlar',
    ];
    const found: string[] = [];
    for (const route of routes) {
      await page.goto(route);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('main').first()).toBeVisible();
      await expect(page.locator('[data-testid$="-loading"]')).toHaveCount(0, { timeout: 15_000 });
      for (const line of await blocking(page)) found.push(`${route}  ${line}`);
    }
    expect(found, found.join('\n')).toEqual([]);
  });
}
