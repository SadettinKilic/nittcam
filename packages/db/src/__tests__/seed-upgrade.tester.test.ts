import { defaultMachineProfile, exampleMachineProfile } from '@nittcam/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbHandle } from '../client';
import { upgradeExampleProfile } from '../seed';
import { forCompany } from '../tenant';
import { newCompany, openTestDb } from './helpers';

/** T020 tester: seed upgrade scenarios beyond the dev's (isolation, mixed machines, rename). */
let h: DbHandle;
beforeAll(async () => {
  h = await openTestDb();
});
afterAll(async () => {
  await h.close();
});

describe('upgradeExampleProfile (tester)', () => {
  it('only the scoped company is upgraded (tenant isolation)', async () => {
    const a = forCompany(h.db, (await newCompany(h, 'UA')).id);
    const b = forCompany(h.db, (await newCompany(h, 'UB')).id);
    const ma = await a.machines.createWithProfile(defaultMachineProfile());
    const mb = await b.machines.createWithProfile(defaultMachineProfile());
    expect(await upgradeExampleProfile(a)).toHaveLength(1);
    expect(await a.machines.listProfileVersions(ma.machine.id)).toHaveLength(2);
    expect(await b.machines.listProfileVersions(mb.machine.id)).toHaveLength(1);
  });

  it('a renamed old seed counts as edited and is untouched', async () => {
    const c = forCompany(h.db, (await newCompany(h, 'UR')).id);
    const p = defaultMachineProfile();
    p.identity.name = 'Benim routerım';
    const m = await c.machines.createWithProfile(p);
    expect(await upgradeExampleProfile(c)).toEqual([]);
    expect(await c.machines.listProfileVersions(m.machine.id)).toHaveLength(1);
  });

  it('with an untouched seed and a user machine: only the seed is upgraded, the user machine keeps one version', async () => {
    const c = forCompany(h.db, (await newCompany(h, 'UM')).id);
    const seed = await c.machines.createWithProfile(defaultMachineProfile());
    const mine = defaultMachineProfile();
    mine.example = false;
    mine.identity.name = 'Atölye CNC';
    const own = await c.machines.createWithProfile(mine);
    const done = await upgradeExampleProfile(c);
    expect(done.map((m) => m.machine.id)).toEqual([seed.machine.id]);
    expect(await c.machines.listProfileVersions(own.machine.id)).toHaveLength(1);
    const latest = await c.machines.getWithProfile(seed.machine.id);
    expect(latest?.profile).toEqual(exampleMachineProfile());
    expect(latest?.version.version).toBe(2);
  });

  it('three runs in a row stay at two versions', async () => {
    const c = forCompany(h.db, (await newCompany(h, 'U3')).id);
    const m = await c.machines.createWithProfile(defaultMachineProfile());
    for (let i = 0; i < 3; i += 1) await upgradeExampleProfile(c);
    expect(await c.machines.listProfileVersions(m.machine.id)).toHaveLength(2);
  });
});
