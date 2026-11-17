import { readFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext } from '@playwright/test';
import tr from '../../apps/web/messages/tr.json' with { type: 'json' };
import { goStep, openNewProject, pasteAndNest, saved, watchConsole } from './wizard-helpers';

/**
 * T022: machine verification (spec §7.3). Air-cut program → approve → test-cut program →
 * measurements → tolerance → verified, per profile version; the export warning links here.
 * Each test creates its own machine so the seeded example stays untouched.
 */
const v = tr.verification;
const states = tr.machines.state;

interface Created {
  id: string;
  version: number;
}

async function newMachine(request: APIRequestContext, name: string): Promise<Created> {
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
  return (await res.json()) as Created;
}

interface Overview {
  profileVersionId: string;
  state: string;
  unverifiedReasons: string[];
  programs: Record<
    'airCut' | 'testCut',
    { ok: boolean; allowed: boolean; files: { name: string; downloadUrl: string }[] }
  >;
}

async function overview(request: APIRequestContext, id: string): Promise<Overview> {
  const res = await request.get(`/api/machines/${id}/verification`);
  expect(res.status()).toBe(200);
  return (await res.json()) as Overview;
}

const GOOD = {
  edgeX: '199,9',
  edgeY: '200,1',
  diagonal: '282,9',
  holeDiameter: '100,05',
  pocketDepth: '9,1',
};

test('air cut → approve → test cut → measurements in tolerance → verified', async ({ page }) => {
  test.setTimeout(90_000);
  const problems = watchConsole(page);
  const m = await newMachine(page.request, `T022 router ${Date.now()}`);

  const before = await overview(page.request, m.id);
  expect(before.state).toBe('draft');
  expect(before.unverifiedReasons).toEqual(['profile', 'post']);
  expect(before.programs.airCut.ok).toBe(true);
  expect(before.programs.testCut).toMatchObject({ ok: true, allowed: false });

  await page.goto(`/makineler/${m.id}/dogrulama`);
  await expect(page.getByTestId('verification-state')).toContainText(states.draft);
  await expect(page.getByTestId('test-cut-locked')).toBeVisible();
  await expect(page.getByTestId('verification-test-part')).toContainText('T2');

  // Download needs the unverified acceptance (rule 10).
  const airDownload = page.getByTestId('air-cut-download');
  await expect(airDownload).toBeDisabled();
  await page.getByTestId('air-cut-accept').check();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('air-cut-download').click(),
  ]);
  const text = (await readFile(await download.path())).toString('utf8');
  expect(text.split('\r\n')[0]).toBe('(DOGRULANMADI, once air cut)');
  expect(text).toContain('AIR CUT TESTI');
  expect(text).toMatch(/\r\nM30\r\n$/);

  // Approve the air cut: every checklist item is required.
  const approve = page.getByTestId('air-approve');
  await expect(approve).toBeDisabled();
  for (const k of ['axes', 'spindle', 'safeZ', 'noContact']) {
    await page.getByTestId(`air-check-${k}`).check();
  }
  await approve.click();
  await expect(page.getByTestId('verification-state')).toContainText(states.air_cut_approved);

  // Test cut: program unlocked, measurements with a decimal comma.
  await expect(page.getByTestId('test-cut-locked')).toHaveCount(0);
  await page.getByTestId('test-cut-accept').check();
  const [cutFile] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('test-cut-download').click(),
  ]);
  expect((await readFile(await cutFile.path())).toString('utf8')).toContain('TEST PARCASI');
  for (const [k, val] of Object.entries(GOOD)) await page.getByTestId(`measure-${k}`).fill(val);
  await page.getByTestId('measure-submit').click();
  await expect(page.getByTestId('measure-result')).toContainText(v.verified);
  await expect(page.getByTestId('verification-state')).toContainText(states.verified);
  await expect(page.getByTestId('verification-history').locator('tbody tr')).toHaveCount(2);

  // Verified profile: only the (still unverified) post keeps the header (D-025, D-031).
  const after = await overview(page.request, m.id);
  expect(after.state).toBe('verified');
  expect(after.unverifiedReasons).toEqual(['post']);
  await expect(page.getByTestId('verification-reasons')).toBeVisible();

  // Phone width: no page-level horizontal scroll (the result table scrolls inside its box).
  await page.setViewportSize({ width: 390, height: 800 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // The machine list shows the state.
  await page.goto('/makineler');
  await expect(page.getByRole('link', { name: new RegExp(`T022 router`) }).first()).toBeVisible();
  expect(problems).toEqual([]);
});

test('API: order, acceptance, form validation and an out-of-tolerance part', async ({
  request,
}) => {
  const m = await newMachine(request, `T022 api ${Date.now()}`);
  const o = await overview(request, m.id);
  const cutUrl = o.programs.testCut.files[0]?.downloadUrl ?? '';
  const airUrl = o.programs.airCut.files[0]?.downloadUrl ?? '';

  // Test cut before the air cut: refused (download and record).
  expect((await request.get(`${cutUrl}?accept=1`)).status()).toBe(409);
  const early = await request.post(`/api/machines/${m.id}/verification`, {
    data: { step: 'testCut', profileVersionId: o.profileVersionId, measurements: {} },
  });
  expect(early.status()).toBe(409);
  // Unverified file without the acceptance: 428.
  expect((await request.get(airUrl)).status()).toBe(428);
  expect((await request.get(`${airUrl}?accept=1`)).status()).toBe(200);
  // Air cut needs every check.
  const partial = await request.post(`/api/machines/${m.id}/verification`, {
    data: {
      step: 'airCut',
      profileVersionId: o.profileVersionId,
      checks: { axes: true, spindle: true, safeZ: true, noContact: false },
    },
  });
  expect(partial.status()).toBe(422);
  const air = await request.post(`/api/machines/${m.id}/verification`, {
    data: {
      step: 'airCut',
      profileVersionId: o.profileVersionId,
      checks: { axes: true, spindle: true, safeZ: true, noContact: true },
    },
  });
  expect(air.status()).toBe(200);
  // Bad form → 422 with the fields.
  const bad = await request.post(`/api/machines/${m.id}/verification`, {
    data: {
      step: 'testCut',
      profileVersionId: o.profileVersionId,
      measurements: { edgeX: 200, edgeY: 'x' },
    },
  });
  expect(bad.status()).toBe(422);
  expect(((await bad.json()) as { error: string }).error).toBe('invalid_measurements');
  // Tool really 8.4 mm: test cut approved, not verified; tool-diameter suggestion.
  const off = await request.post(`/api/machines/${m.id}/verification`, {
    data: {
      step: 'testCut',
      profileVersionId: o.profileVersionId,
      measurements: {
        edgeX: 199.6,
        edgeY: 199.6,
        diagonal: 282.27,
        holeDiameter: 100.4,
        pocketDepth: 9,
      },
    },
  });
  expect(off.status()).toBe(200);
  const body = (await off.json()) as {
    state: string;
    evaluation: { suggestions: { kind: string; to?: number }[] };
  };
  expect(body.state).toBe('test_cut_approved');
  expect(body.evaluation.suggestions).toContainEqual({
    kind: 'toolDiameter',
    tool: 2,
    from: 8,
    to: 8.4,
  });
  // Stale profile version → 409.
  const stale = await request.post(`/api/machines/${m.id}/verification`, {
    data: {
      step: 'airCut',
      profileVersionId: '00000000-0000-4000-8000-00000000abcd',
      checks: { axes: true, spindle: true, safeZ: true, noContact: true },
    },
  });
  expect(stale.status()).toBe(409);
});

test('export: the unverified warning names the reasons and links to the verification', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openNewProject(page, 'parcalar');
  await pasteAndNest(page);
  await saved(page);
  await goStep(page, 'export');
  await expect(page.getByTestId('export-status')).toHaveAttribute('data-ok', 'true', {
    timeout: 30_000,
  });
  await expect(page.getByTestId('export-unverified-reasons')).toContainText(
    tr.wizard.export.reasons.example,
  );
  const link = page.getByTestId('export-verify-link');
  await expect(link).toHaveAttribute('href', /\/makineler\/[0-9a-f-]+\/dogrulama$/);
  await link.click();
  await expect(page.getByRole('heading', { name: v.title })).toBeVisible();
});
