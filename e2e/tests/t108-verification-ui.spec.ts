import { expect, test, type APIRequestContext } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { expectNoA11yViolations } from './visual/helpers';

// T108: verification page redesign — stepper, download cards with the rule-10 acceptance,
// measurement form with inline tolerance result and suggestion card.
const v = tr.verification;

async function newMachine(request: APIRequestContext, name: string): Promise<string> {
  const list = (await (await request.get('/api/machines')).json()) as { id: string }[];
  const first = list[0];
  if (!first) throw new Error('no seeded machine');
  const seeded = (await (await request.get(`/api/machines/${first.id}`)).json()) as {
    profile: Record<string, unknown> & { identity: Record<string, unknown> };
  };
  const profile = structuredClone(seeded.profile);
  profile.example = false;
  profile.identity = { ...profile.identity, name };
  const res = await request.post('/api/machines', { data: { profile } });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

test('stepper, rule-10 acceptance, inline result and suggestions', async ({ page }) => {
  const id = await newMachine(page.request, `T108 router ${Date.now()}`);
  await page.goto(`/makineler/${id}/dogrulama`);

  // Stepper: draft done, air cut current.
  const steps = page.getByTestId('verification-stepper').getByRole('listitem');
  await expect(steps).toHaveCount(4);
  await expect(steps.nth(0)).toHaveAttribute('data-status', 'done');
  await expect(steps.nth(1)).toHaveAttribute('aria-current', 'step');
  await expect(steps.nth(1)).toContainText(v.stepShort.air_cut_approved);

  // Rule 10: download is a disabled button (no href) until the acceptance is checked.
  const download = page.getByTestId('air-cut-download');
  await expect(download).toBeDisabled();
  await expect(download).not.toHaveAttribute('href');
  await page.getByTestId('air-cut-accept').check();
  await expect(page.getByTestId('air-cut-download')).toHaveAttribute('href', /accept=1/);
  await page.getByTestId('air-cut-accept').uncheck();
  await expect(page.getByTestId('air-cut-download')).toBeDisabled();
  await expectNoA11yViolations(page);

  for (const k of ['axes', 'spindle', 'safeZ', 'noContact']) {
    await page.getByTestId(`air-check-${k}`).check();
  }
  await page.getByTestId('air-approve').click();
  await expect(steps.nth(2)).toHaveAttribute('aria-current', 'step');

  // A typo stays in the form with an inline message and no request.
  let posts = 0;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/verification')) posts++;
  });
  await page.getByTestId('measure-edgeX').fill('19x');
  await page.getByTestId('measure-submit').click();
  await expect(page.getByText(v.issues.NOT_A_NUMBER)).toBeVisible();
  expect(posts).toBe(0);

  // Out of tolerance: inline deviation badges, the result and a suggestion card.
  const values = {
    edgeX: '199,4',
    edgeY: '199,4',
    diagonal: '282,2',
    holeDiameter: '100,6',
    pocketDepth: '9',
  };
  for (const [k, val] of Object.entries(values)) await page.getByTestId(`measure-${k}`).fill(val);
  await page.getByTestId('measure-submit').click();
  await expect(page.getByTestId('measure-result')).toContainText(v.notVerified);
  await expect(page.getByTestId('measure-suggestions')).toBeVisible();
  await expect(page.locator('label[for="measure-edgeX"]')).toContainText('mm');
  await expectNoA11yViolations(page);
});
