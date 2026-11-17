import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * T022 tester: server-side state machine per profile version, illegal transitions, malformed
 * input on the verification routes. Own machines only (the seeded example stays untouched).
 */
const CHECKS = { axes: true, spindle: true, safeZ: true, noContact: true };
const FORM = { edgeX: 200, edgeY: 200, diagonal: 282.84, holeDiameter: 100, pocketDepth: 9 };

async function newMachine(request: APIRequestContext, name: string) {
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
  return { id: ((await res.json()) as { id: string }).id, profile };
}
const ov = async (r: APIRequestContext, id: string) =>
  (await (await r.get(`/api/machines/${id}/verification`)).json()) as {
    profileVersionId: string;
    state: string;
    programs: Record<string, { allowed: boolean; files: { downloadUrl: string }[] }>;
  };
const post = (r: APIRequestContext, id: string, data: unknown) =>
  r.post(`/api/machines/${id}/verification`, { data });

test('profile change after verification: reverify_needed, test cut locked again, per version', async ({
  request,
}) => {
  const m = await newMachine(request, `T022 tester reverify ${Date.now()}`);
  const o1 = await ov(request, m.id);
  expect(
    (
      await post(request, m.id, {
        step: 'airCut',
        profileVersionId: o1.profileVersionId,
        checks: CHECKS,
      })
    ).status(),
  ).toBe(200);
  const ok = await post(request, m.id, {
    step: 'testCut',
    profileVersionId: o1.profileVersionId,
    measurements: FORM,
  });
  expect(((await ok.json()) as { state: string }).state).toBe('verified');
  expect((await ov(request, m.id)).state).toBe('verified');

  // Change a machine-relevant field (safe Z) → new immutable version.
  const edited = structuredClone(m.profile) as Record<string, unknown>;
  edited.safeZ = 33;
  expect((await request.put(`/api/machines/${m.id}`, { data: { profile: edited } })).status()).toBe(
    200,
  );
  const o2 = await ov(request, m.id);
  expect(o2.state).toBe('reverify_needed');
  expect(o2.profileVersionId).not.toBe(o1.profileVersionId);
  // Test cut file and record are locked again; air cut file is not.
  expect(o2.programs.testCut?.allowed).toBe(false);
  expect(
    (await request.get(`${o2.programs.testCut?.files[0]?.downloadUrl ?? '/x'}?accept=1`)).status(),
  ).toBe(409);
  expect(
    (
      await post(request, m.id, {
        step: 'testCut',
        profileVersionId: o2.profileVersionId,
        measurements: FORM,
      })
    ).status(),
  ).toBe(409);
  // Old version id is stale for new records.
  expect(
    (
      await post(request, m.id, {
        step: 'airCut',
        profileVersionId: o1.profileVersionId,
        checks: CHECKS,
      })
    ).status(),
  ).toBe(409);
  // New air cut on the new version → test cut open again.
  expect(
    (
      await post(request, m.id, {
        step: 'airCut',
        profileVersionId: o2.profileVersionId,
        checks: CHECKS,
      })
    ).status(),
  ).toBe(200);
  expect((await ov(request, m.id)).state).toBe('air_cut_approved');
});

test('malformed requests are 4xx, never 500', async ({ request }) => {
  const m = await newMachine(request, `T022 tester bad ${Date.now()}`);
  const o = await ov(request, m.id);
  const nil = '00000000-0000-4000-8000-000000000000';
  expect((await request.get('/api/machines/not-a-uuid/verification')).status()).toBe(404);
  expect((await request.get(`/api/machines/${nil}/verification`)).status()).toBe(404);
  expect((await request.get(`/api/machines/${m.id}/verification/bogus/x.nc`)).status()).toBe(404);
  expect(
    (await request.get(`/api/machines/${m.id}/verification/airCut/nope.nc?accept=1`)).status(),
  ).toBe(404);
  for (const data of [
    {},
    { step: 'verified', profileVersionId: o.profileVersionId },
    { step: 'airCut', profileVersionId: 'x', checks: CHECKS },
    { step: 'airCut', profileVersionId: o.profileVersionId },
    { step: 'airCut', profileVersionId: o.profileVersionId, checks: null },
  ]) {
    expect((await post(request, m.id, data)).status(), JSON.stringify(data)).toBe(400);
  }
  const raw = await request.post(`/api/machines/${m.id}/verification`, {
    headers: { 'content-type': 'application/json' },
    data: '{not json',
  });
  expect(raw.status()).toBe(400);
  // Truthy-but-not-true check values do not count.
  for (const bad of ['true', 1, 'yes']) {
    const r = await post(request, m.id, {
      step: 'airCut',
      profileVersionId: o.profileVersionId,
      checks: { ...CHECKS, axes: bad },
    });
    expect(r.status()).toBe(422);
  }
  expect((await ov(request, m.id)).state).toBe('draft');
  // Test cut on another machine's version id: stale/409, state untouched.
  const n = await newMachine(request, `T022 tester other ${Date.now()}`);
  const on = await ov(request, n.id);
  expect(
    (
      await post(request, m.id, {
        step: 'airCut',
        profileVersionId: on.profileVersionId,
        checks: CHECKS,
      })
    ).status(),
  ).toBe(409);
  expect((await ov(request, m.id)).state).toBe('draft');
});

test('string measurements and absurd numbers are 422 and store nothing', async ({ request }) => {
  const m = await newMachine(request, `T022 tester form ${Date.now()}`);
  const o = await ov(request, m.id);
  await post(request, m.id, {
    step: 'airCut',
    profileVersionId: o.profileVersionId,
    checks: CHECKS,
  });
  for (const bad of ['199,9', '200', 1e9, -1, 0, null]) {
    const r = await post(request, m.id, {
      step: 'testCut',
      profileVersionId: o.profileVersionId,
      measurements: { ...FORM, edgeX: bad },
    });
    expect(r.status(), String(bad)).toBe(422);
  }
  expect((await ov(request, m.id)).state).toBe('air_cut_approved');
});
