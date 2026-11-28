import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// B72 tester (T356): Doğrulama family tabs and the ACM field kit section at 1440 and 1024, axe
// clean; a machine without the ACM set shows the unavailable note.

const SHOTS = '__screenshots__/b72';

async function acmMachine(request: APIRequestContext, withAcm = true): Promise<string> {
  const list = (await (await request.get('/api/machines')).json()) as {
    id: string;
    example?: boolean;
  }[];
  const seeded = list[0];
  if (!seeded) throw new Error('no machine');
  const detail = (await (await request.get(`/api/machines/${seeded.id}`)).json()) as {
    profile: Record<string, unknown> & {
      identity: { name: string };
      materials: Record<string, unknown>[];
      tools: { number: number; type: string }[];
      toolChanger: { type: string; capacity?: number };
    };
  };
  const p = structuredClone(detail.profile);
  p.example = false;
  p.identity.name = `ACM e2e ${Date.now() % 100000}`;
  const base = p.materials[0];
  const flat = p.tools.find((t) => t.type === 'flatEndMill');
  if (!base || !flat) throw new Error('seed has no set or flat end mill');
  if (withAcm) {
    p.materials = [
      ...p.materials,
      { ...base, material: 'acm', thickness: 4, tool: flat.number, stepDown: 2, tabs: undefined },
    ];
    p.tools = [
      ...p.tools.filter((t) => t.number !== 7),
      {
        number: 7,
        type: 'vBit',
        diameter: 12,
        fluteLength: 8,
        flutes: 2,
        angleDeg: 90,
        tipDiameter: 0.2,
      } as never,
    ];
    if (p.toolChanger.type === 'auto') p.toolChanger = { ...p.toolChanger, capacity: 8 };
  }
  const res = await request.post('/api/machines', { data: { profile: p } });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function axeClean(page: Page) {
  await page.waitForTimeout(300);
  const r = await new AxeBuilder({ page }).analyze();
  expect(
    r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id),
  ).toEqual([]);
}

for (const w of [1440, 1024]) {
  test(`Doğrulama: family tabs, ACM view with the tray; field kit ACM section (${w})`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width: w, height: 900 });
    const id = await acmMachine(request);
    await page.goto(`/makineler/${id}/dogrulama`);
    const tab = page.getByTestId('verification-family-composite');
    await expect(tab).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('verification-family-woodBoard')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/dogrulama-board-${w}.png`, fullPage: true });
    await tab.click();
    await expect(page).toHaveURL(/aile=kompozit/);
    await expect(page.getByTestId('verification-tray')).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/dogrulama-acm-${w}.png`, fullPage: true });
    await axeClean(page);
    // Reload keeps the family.
    await page.reload();
    await expect(page.getByTestId('verification-tray')).toBeVisible({ timeout: 20_000 });

    await page.goto(`/makineler/${id}/saha-kiti`);
    await expect(page.getByTestId('field-kit-acm-form')).toBeVisible({
      timeout: 20_000,
    });
    await page.screenshot({ path: `${SHOTS}/saha-kiti-${w}.png`, fullPage: true });
    await axeClean(page);
  });
}

test('field kit: a machine without the ACM set shows the unavailable note', async ({
  page,
  request,
}) => {
  const id = await acmMachine(request, false);
  await page.goto(`/makineler/${id}/saha-kiti`);
  await expect(page.getByTestId('field-kit-acm-unavailable')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('field-kit-acm-form')).toHaveCount(0);
});
