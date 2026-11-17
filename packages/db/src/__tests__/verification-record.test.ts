/** T022: recording verification steps and reading the history (spec §7.3). */
import { randomUUID } from 'node:crypto';
import { defaultMachineProfile, type MachineProfile } from '@nittcam/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbHandle } from '../client';
import { NotFound, forCompany, type CompanyScope } from '../tenant';
import { newCompany, openTestDb } from './helpers';

let h: DbHandle;
let scope: CompanyScope;
let other: CompanyScope;

beforeAll(async () => {
  h = await openTestDb();
  scope = forCompany(h.db, (await newCompany(h, 'Verify')).id);
  other = forCompany(h.db, (await newCompany(h, 'Other')).id);
});
afterAll(async () => {
  await h.close();
});

function fresh(): MachineProfile {
  const p = defaultMachineProfile();
  p.example = false;
  p.identity.name = `Router ${randomUUID().slice(0, 6)}`;
  return p;
}

describe('recordVerification', () => {
  it('air cut → test cut → verified; the state follows the latest record', async () => {
    const m = await scope.machines.createWithProfile(fresh());
    const id = m.machine.id;
    const pv = m.version.id;
    await scope.machines.recordVerification(id, { profileVersionId: pv, stage: 'air_cut_approved' });
    expect((await scope.machines.getWithProfile(id))?.state).toBe('air_cut_approved');
    const row = await scope.machines.recordVerification(id, {
      profileVersionId: pv,
      stage: 'verified',
      measurements: { input: { edgeX: 200 } },
    });
    expect(row.toolSet).toEqual(m.profile.tools);
    expect(row.postVersion).toBe(m.profile.post.version);
    expect(row.level).toBe('user_approved');
    expect((await scope.machines.getWithProfile(id))?.state).toBe('verified');
    const hist = await scope.machines.verificationHistory(id);
    expect(hist.map((x) => [x.validation.stage, x.version])).toEqual([
      ['verified', 1],
      ['air_cut_approved', 1],
    ]);
    expect(hist[0]?.validation.measurements).toEqual({ input: { edgeX: 200 } });
  });

  it('a profile change after verification → reverify_needed, the old version stays verified', async () => {
    const m = await scope.machines.createWithProfile(fresh());
    await scope.machines.recordVerification(m.machine.id, {
      profileVersionId: m.version.id,
      stage: 'verified',
    });
    const edited = structuredClone(m.profile);
    edited.safeZ = 25;
    const saved = await scope.machines.saveProfile(m.machine.id, edited);
    expect(saved.state).toBe('reverify_needed');
    const v1 = await scope.machines.getProfileVersion(m.machine.id, { version: 1 });
    expect(v1?.state).toBe('verified');
  });

  it('a version of another machine or company is refused', async () => {
    const a = await scope.machines.createWithProfile(fresh());
    const b = await scope.machines.createWithProfile(fresh());
    await expect(
      scope.machines.recordVerification(a.machine.id, {
        profileVersionId: b.version.id,
        stage: 'air_cut_approved',
      }),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      other.machines.recordVerification(a.machine.id, {
        profileVersionId: a.version.id,
        stage: 'air_cut_approved',
      }),
    ).rejects.toBeInstanceOf(NotFound);
    expect(await other.machines.verificationHistory(a.machine.id)).toEqual([]);
  });
});
