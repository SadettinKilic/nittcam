import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { openNewProject, pasteAndNest, projectId, saved, wizardReady } from './wizard-helpers';

// B35 tester (T175, T178, T290): DXF download of a Turkish-named project (ASCII name, both kinds,
// stable bytes), an exported project opens on Dışa aktar, Projeler + Silinenler axe / screenshots
// at 1440 light/dark and a 390 smoke check.

async function axeSerious(page: Page) {
  await page.waitForTimeout(400);
  const res = await new AxeBuilder({ page }).analyze();
  return res.violations
    .filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

test('B35 tester: DXF download names, exported project opens on Dışa aktar', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page);
  const name = `Çekmeceli dolap İğş ${Math.random().toString(36).slice(2, 6)}`;
  const field = page.getByTestId('project-name');
  await field.fill(name);
  await field.press('Enter');
  await saved(page);
  const id = await projectId(page);
  const cur = (await (await request.get(`/api/projects/${id}`)).json()) as { revision: number };

  for (const tur of ['dizilim', 'parcalar']) {
    const url = `/api/projects/${id}/dxf?revision=${cur.revision}&tur=${tur}`;
    const r1 = await request.get(url);
    expect(r1.status(), tur).toBe(200);
    const cd = r1.headers()['content-disposition'] ?? '';
    // eslint-disable-next-line no-control-regex
    expect(cd, tur).toMatch(/^attachment; filename="[\x20-\x7e]+\.dxf"$/);
    expect(cd).toMatch(/Cekmeceli_dolap_Igs_/);
    const body = await r1.text();
    expect(
      body.startsWith('0\r\nSECTION') || body.startsWith('  0') || body.includes('SECTION'),
    ).toBe(true);
    expect(body).toContain('DIS_KESIM');
    const r2 = await request.get(url);
    expect(r2.headers()['etag']).toBe(r1.headers()['etag']);
  }
  expect(
    (
      await request.get(`/api/projects/${id}/dxf?revision=${cur.revision + 1}&tur=dizilim`)
    ).status(),
  ).toBe(409);

  // An exported project opens on Dışa aktar (T290).
  const exp = await request.post(`/api/projects/${id}/export`, {
    data: { revision: cur.revision, acceptUnverified: true, checklistConfirmed: true },
  });
  expect(exp.status()).toBeLessThan(300);
  await page.goto(`/projeler/${id}`);
  await wizardReady(page, 'export');
});

test('B35 tester: Projeler and Silinenler axe + screenshots, 390 smoke', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('/projeler');
  await expect(page.getByTestId('projects-list')).toBeVisible({ timeout: 30_000 });
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1440, height: 900 });
    expect(await axeSerious(page), `projeler ${scheme}`).toEqual([]);
    await page.screenshot({ path: `__screenshots__/b35-projeler-1440-${scheme}.png` });
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByTestId('deleted-tab').click();
  await expect(
    page.getByTestId('deleted-list').or(page.getByTestId('deleted-empty')),
  ).toBeVisible();
  expect(await axeSerious(page), 'silinenler').toEqual([]);
  await page.screenshot({ path: `__screenshots__/b35-silinenler-1440-light.png` });

  await page.goto('/projeler');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByTestId('projects-list')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await expect(page.getByTestId('projects-search')).toBeVisible();
  expect(await axeSerious(page), 'projeler 390').toEqual([]);
  await page.screenshot({ path: `__screenshots__/b35-projeler-390.png`, fullPage: true });
  expect(tr.projects).toBeTruthy();
});
