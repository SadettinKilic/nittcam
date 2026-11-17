/**
 * T022 hardening (D-031): the verification POST against an in-memory PGlite database.
 * - a step whose program does not generate or fails its checks for the version → 422
 *   `program_failed` with a Turkish message, nothing recorded (air cut and test cut);
 * - no air-cut re-record once the version has a test cut (409, no silent downgrade).
 */
import { randomUUID } from 'node:crypto';
import type { MachineProfile } from '@nittcam/core';
import type { DbHandle } from '@nittcam/db';
import { afterAll, describe, expect, it } from 'vitest';
import { companyScope } from '../../../lib/server/company';
import type {
  VerificationApiError,
  VerificationOverview,
  VerificationResponse,
} from '../../../lib/verification-api';
import { GET as overview, POST as record } from './[id]/verification/route';

const CHECKS = { axes: true, spindle: true, safeZ: true, noContact: true };
const post = (body: unknown) =>
  new Request('http://test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

/** A copy of the seeded machine (its air cut and test cut pass), not an example, edited. */
async function machineWith(edit: (p: MachineProfile) => void = () => undefined) {
  const scope = await companyScope();
  const [seeded] = await scope.machines.listWithProfiles();
  if (!seeded) throw new Error('no seeded machine');
  const p = structuredClone(seeded.profile);
  p.example = false;
  p.identity.name = `Router ${randomUUID().slice(0, 6)}`;
  edit(p);
  const m = await scope.machines.createWithProfile(p);
  return { id: m.machine.id, versionId: m.version.id, scope };
}

async function view(id: string): Promise<VerificationOverview> {
  const res = await overview(new Request('http://test'), ctx(id));
  expect(res.status).toBe(200);
  return (await res.json()) as VerificationOverview;
}

function inTolerance(o: VerificationOverview) {
  const t = o.testPart;
  if (!t) throw new Error('no test part');
  return {
    edgeX: t.edge,
    edgeY: t.edge,
    diagonal: Math.round(t.diagonal * 100) / 100,
    holeDiameter: t.holeDiameter,
    pocketDepth: t.pocketDepth,
    thickness: t.thickness,
  };
}

afterAll(async () => {
  const cache = globalThis as { nittcamDb?: Promise<DbHandle> };
  await (await cache.nittcamDb)?.close();
});

describe('POST /api/machines/:id/verification: program must pass', () => {
  it('air cut whose program fails its checks (Z travel too short) → 422, nothing recorded', async () => {
    const m = await machineWith((p) => {
      p.workEnvelope = { ...p.workEnvelope, z: 30 };
    });
    const o = await view(m.id);
    expect(o.programs.airCut.ok).toBe(false);
    const res = await record(
      post({ step: 'airCut', profileVersionId: m.versionId, checks: CHECKS }),
      ctx(m.id),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as VerificationApiError;
    expect(body.error).toBe('program_failed');
    expect(body.error === 'program_failed' ? body.message : '').toMatch(/kontrol/);
    expect((await view(m.id)).state).toBe('draft');
    expect(await m.scope.machines.verificationHistory(m.id)).toEqual([]);
  });

  it('test cut whose program fails (unknown post) → 422, nothing recorded', async () => {
    const m = await machineWith((p) => {
      p.post = { id: 'nope', version: '1.0' };
    });
    await m.scope.machines.recordVerification(m.id, {
      profileVersionId: m.versionId,
      stage: 'air_cut_approved',
    });
    const o = await view(m.id);
    expect(o.state).toBe('air_cut_approved');
    expect(o.programs.testCut.ok).toBe(false);
    const res = await record(
      post({ step: 'testCut', profileVersionId: m.versionId, measurements: inTolerance(o) }),
      ctx(m.id),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as VerificationApiError).error).toBe('program_failed');
    expect((await view(m.id)).state).toBe('air_cut_approved');
    expect(await m.scope.machines.verificationHistory(m.id)).toHaveLength(1);
  });

  it('a passing program is still approved (control)', async () => {
    const m = await machineWith();
    const res = await record(
      post({ step: 'airCut', profileVersionId: m.versionId, checks: CHECKS }),
      ctx(m.id),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as VerificationResponse).state).toBe('air_cut_approved');
  });
});

describe('POST /api/machines/:id/verification: no silent downgrade', () => {
  it.each([
    ['verified', 0],
    ['test_cut_approved', 0.5],
  ] as const)('air cut on a %s version → 409, state kept', async (stage, off) => {
    const m = await machineWith();
    const air = await record(
      post({ step: 'airCut', profileVersionId: m.versionId, checks: CHECKS }),
      ctx(m.id),
    );
    expect(air.status).toBe(200);
    // Re-approving the air cut before any test cut is harmless (same stage).
    const again = await record(
      post({ step: 'airCut', profileVersionId: m.versionId, checks: CHECKS }),
      ctx(m.id),
    );
    expect(again.status).toBe(200);
    const form = inTolerance(await view(m.id));
    const cut = await record(
      post({
        step: 'testCut',
        profileVersionId: m.versionId,
        measurements: { ...form, holeDiameter: form.holeDiameter + off },
      }),
      ctx(m.id),
    );
    expect(cut.status).toBe(200);
    expect(((await cut.json()) as VerificationResponse).state).toBe(stage);
    const before = await m.scope.machines.verificationHistory(m.id);

    const res = await record(
      post({ step: 'airCut', profileVersionId: m.versionId, checks: CHECKS }),
      ctx(m.id),
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'not_allowed', state: stage });
    expect((await view(m.id)).state).toBe(stage);
    expect(await m.scope.machines.verificationHistory(m.id)).toHaveLength(before.length);
  });

  it('after a profile change the air cut restarts the flow on the new version', async () => {
    const m = await machineWith();
    await m.scope.machines.recordVerification(m.id, {
      profileVersionId: m.versionId,
      stage: 'verified',
    });
    const cur = await m.scope.machines.getWithProfile(m.id);
    if (!cur) throw new Error('machine');
    const edited = structuredClone(cur.profile);
    edited.safeZ += 1;
    const saved = await m.scope.machines.saveProfile(m.id, edited);
    expect(saved.state).toBe('reverify_needed');
    const res = await record(
      post({ step: 'airCut', profileVersionId: saved.version.id, checks: CHECKS }),
      ctx(m.id),
    );
    expect(res.status).toBe(200);
    expect((await view(m.id)).state).toBe('air_cut_approved');
  });
});
