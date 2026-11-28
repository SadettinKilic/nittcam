import { expect, test, type APIRequestContext } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { expectNoA11yViolations } from './visual/helpers';
import { pickOption } from './wizard-helpers';

// MB4 tester: T351 server refusal (API), ACM warn-only, 390 px smoke + axe on material dialog / machine form.
/* eslint-disable @typescript-eslint/no-explicit-any */
async function seeded(request: APIRequestContext) {
  const list = (await (await request.get('/api/machines')).json()) as { id: string }[];
  return (await (await request.get(`/api/machines/${list[0]?.id}`)).json()) as {
    id: string;
    profile: any;
  };
}
function withSet(profile: any, material: string, patch: Record<string, number>) {
  const p = structuredClone(profile);
  p.spindle = { ...p.spindle, minRpm: 6000, maxRpm: 24000 };
  p.materials = [
    ...p.materials,
    {
      material,
      thickness: 3,
      feed: 1800,
      plungeFeed: 400,
      rpm: 18000,
      stepDown: 1.5,
      tool: 1,
      ...patch,
    },
  ];
  return p;
}

test.describe('MB4 T351 server rules', () => {
  test('aluminium chip load outside band is refused by the API; ACM only warns', async ({
    request,
  }) => {
    const m = await seeded(request);
    const bad = await request.post('/api/machines', {
      data: { profile: withSet(m.profile, 'aluminium', { feed: 5000 }) },
    });
    expect(bad.status()).toBe(400);
    const json = (await bad.json()) as { error: string; issues?: { key?: string }[] };
    expect(json.error).toBe('invalid_profile');
    expect(JSON.stringify(json.issues)).toContain('chipLoadOutsideBand');
    // step-down far above the ceiling
    const deep = await request.post('/api/machines', {
      data: { profile: withSet(m.profile, 'aluminium', { stepDown: 20 }) },
    });
    expect(deep.status()).toBe(400);
    expect(JSON.stringify(await deep.json())).toContain('stepDownAboveCeiling');
    // ACM with the same out-of-band feed is accepted
    const acm = await request.post('/api/machines', {
      data: { profile: withSet(m.profile, 'acm', { feed: 5000 }) },
    });
    expect(acm.status(), await acm.text()).toBeLessThan(300);
  });
});

for (const [w, h] of [
  [1440, 900],
  [390, 844],
] as const) {
  test(`MB4 tester ${w}px: material dialog and machine form`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/ayarlar/malzemeler');
    await page.getByTestId('material-add').click();
    const dialog = page.getByTestId('material-dialog');
    await pickOption(dialog.getByTestId('material-kind'), tr.materials.aluminium);
    await expect(dialog.getByTestId('material-alloy')).toBeVisible();
    await page.waitForTimeout(500);
    await expectNoA11yViolations(page);
    await page.goto('/makineler');
    await page.getByRole('button', { name: tr.machines.add }).click();
    await page.getByTestId('materials-add-acm').click();
    await page.waitForTimeout(500);
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(over).toBeLessThanOrEqual(0);
    await expectNoA11yViolations(page);
  });
}
