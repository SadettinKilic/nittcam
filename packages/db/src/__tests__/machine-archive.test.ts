/**
 * T289: archiving a machine is a soft delete. The row, its profile versions and validations stay
 * (old projects and exports keep working); `listWithProfiles` still returns it with `archivedAt`
 * set so callers can hide it; restore clears it; tenant-scoped like the T178 project delete.
 */
import { exampleMachineProfile } from '@nittcam/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbHandle } from '../client';
import { seedDefaultProfile } from '../seed';
import { forCompany, type CompanyScope } from '../tenant';
import { newCompany, openTestDb } from './helpers';

let h: DbHandle;
let a: CompanyScope;
let b: CompanyScope;

beforeAll(async () => {
  h = await openTestDb();
  a = forCompany(h.db, (await newCompany(h, 'A')).id);
  b = forCompany(h.db, (await newCompany(h, 'B')).id);
});
afterAll(async () => {
  await h.close();
});

describe('machines.setArchived (T289)', () => {
  it('archives the sample machine, keeps its versions, restores', async () => {
    const sample = await seedDefaultProfile(a);
    const id = sample.machine.id;
    const archived = await a.machines.setArchived(id, true);
    expect(archived?.archivedAt).toBeInstanceOf(Date);

    // kept: the machine with its profile (old projects open, exports reference the version)
    const listed = (await a.machines.listWithProfiles()).find((m) => m.machine.id === id);
    expect(listed?.machine.archivedAt).toBeInstanceOf(Date);
    expect((await a.machines.getWithProfile(id))?.profile.example).toBe(true);
    expect(await a.machines.getProfileVersion(id, { version: 1 })).not.toBeNull();
    // a profile edit on an archived machine still makes a new version (no special case)
    expect((await a.machines.saveProfile(id, exampleMachineProfile())).version.version).toBe(2);

    const restored = await a.machines.setArchived(id, false);
    expect(restored?.archivedAt).toBeNull();
  });

  it('another company cannot archive or restore the machine', async () => {
    const { machine } = await seedDefaultProfile(a);
    expect(await b.machines.setArchived(machine.id, true)).toBeNull();
    expect((await a.machines.getWithProfile(machine.id))?.machine.archivedAt).toBeNull();
    await a.machines.setArchived(machine.id, true);
    expect(await b.machines.setArchived(machine.id, false)).toBeNull();
    expect((await a.machines.getWithProfile(machine.id))?.machine.archivedAt).toBeInstanceOf(Date);
  });
});
