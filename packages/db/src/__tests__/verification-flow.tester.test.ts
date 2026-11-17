/** Tester: per-profile-version verification flow and tenant isolation (T022, spec §7.3). */
import { randomUUID } from 'node:crypto';
import { defaultMachineProfile, canRecordVerification, type MachineProfile } from '@nittcam/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbHandle } from '../client';
import { forCompany, type CompanyScope } from '../tenant';
import { newCompany, openTestDb } from './helpers';

let h: DbHandle;
let scope: CompanyScope;
let other: CompanyScope;

beforeAll(async () => {
  h = await openTestDb();
  scope = forCompany(h.db, (await newCompany(h, 'VFlow')).id);
  other = forCompany(h.db, (await newCompany(h, 'VFlowOther')).id);
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

describe('verification per profile version', () => {
  it('a new version after verification needs a fresh air cut before a test cut', async () => {
    const m = await scope.machines.createWithProfile(fresh());
    const id = m.machine.id;
    await scope.machines.recordVerification(id, {
      profileVersionId: m.version.id,
      stage: 'air_cut_approved',
    });
    await scope.machines.recordVerification(id, {
      profileVersionId: m.version.id,
      stage: 'verified',
    });
    const edited = structuredClone(m.profile);
    edited.safeZ = 31;
    const saved = await scope.machines.saveProfile(id, edited);
    expect(saved.state).toBe('reverify_needed');
    const cur = await scope.machines.getWithProfile(id);
    expect(cur?.state).toBe('reverify_needed');
    expect(cur?.version.id).not.toBe(m.version.id);
    expect(canRecordVerification(cur?.state ?? 'draft', 'testCut')).toBe(false);
    // Air cut on the new version → air_cut_approved for v2 only.
    await scope.machines.recordVerification(id, {
      profileVersionId: cur?.version.id ?? '',
      stage: 'air_cut_approved',
    });
    expect((await scope.machines.getWithProfile(id))?.state).toBe('air_cut_approved');
    // A record against the OLD version does not re-verify the new one.
    const hist = await scope.machines.verificationHistory(id);
    expect(hist.map((x) => x.version).sort()).toEqual([1, 1, 2]);
  });

  it('display-name edit keeps the verification (D-016)', async () => {
    const m = await scope.machines.createWithProfile(fresh());
    await scope.machines.recordVerification(m.machine.id, {
      profileVersionId: m.version.id,
      stage: 'verified',
    });
    const edited = structuredClone(m.profile);
    edited.identity.name = `${edited.identity.name} yeni`;
    await scope.machines.saveProfile(m.machine.id, edited);
    expect((await scope.machines.getWithProfile(m.machine.id))?.state).toBe('verified');
  });

  it('another company sees neither state nor history of the machine', async () => {
    const m = await scope.machines.createWithProfile(fresh());
    await scope.machines.recordVerification(m.machine.id, {
      profileVersionId: m.version.id,
      stage: 'air_cut_approved',
    });
    expect(await other.machines.getWithProfile(m.machine.id)).toBeNull();
    expect(await other.machines.verificationHistory(m.machine.id)).toEqual([]);
  });
});
