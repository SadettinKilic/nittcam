import { randomUUID } from 'node:crypto';
import {
  defaultMachineProfile,
  EXAMPLE_PROFILE_NAME,
  exampleMachineProfile,
  type MachineProfile,
} from '@nittcam/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbHandle } from '../client';
import { seedDefaultProfile, upgradeExampleProfile } from '../seed';
import {
  companies,
  forCompany,
  InvalidMachineProfile,
  NotFound,
  type CompanyScope,
} from '../tenant';
import { newCompany, openTestDb } from './helpers';

let h: DbHandle;
let scope: CompanyScope;
let other: CompanyScope;

beforeAll(async () => {
  h = await openTestDb();
  scope = forCompany(h.db, (await newCompany(h, 'A')).id);
  other = forCompany(h.db, (await newCompany(h, 'B')).id);
});
afterAll(async () => {
  await h.close();
});

function profile(mutate: (p: MachineProfile) => void = () => {}): MachineProfile {
  const p = defaultMachineProfile();
  p.example = false;
  p.identity.name = `Router ${randomUUID().slice(0, 6)}`;
  mutate(p);
  return p;
}

const toolRows = async (s: CompanyScope, machineId: string) =>
  (await s.tools.list())
    .filter((t) => t.machineId === machineId)
    .map((t) => [t.number, t.type, t.diameter])
    .sort((a, b) => Number(a[0]) - Number(b[0]));

describe('machine profiles (T010)', () => {
  it('createWithProfile: machine row, version 1 with the JSON, synced tools, draft', async () => {
    const p = profile((x) => (x.identity.brand = 'Acme'));
    const r = await scope.machines.createWithProfile(p);
    expect(r.version.version).toBe(1);
    expect(r.version.profile).toEqual(p);
    expect(r.version.postVersion).toBe('1.0');
    expect(r.version.postConfig).toEqual({ id: 'generic' });
    expect(r.machine).toMatchObject({ name: p.identity.name, brand: 'Acme' });
    expect(r.state).toBe('draft');
    expect(await toolRows(scope, r.machine.id)).toEqual([
      [1, 'flatEndMill', 6],
      [2, 'flatEndMill', 8],
    ]);
  });

  it('saveProfile increments the version, keeps old versions and re-syncs tools', async () => {
    const { machine } = await scope.machines.createWithProfile(profile());
    const next = profile((x) => {
      x.identity.name = 'Renamed';
      x.tools = [{ number: 3, type: 'compression', diameter: 10, fluteLength: 32, flutes: 2 }];
      x.materials = [];
    });
    const saved = await scope.machines.saveProfile(machine.id, next);
    expect(saved.version.version).toBe(2);
    expect(saved.machine.name).toBe('Renamed');
    const third = await scope.machines.saveProfile(machine.id, next);
    expect(third.version.version).toBe(3);

    const versions = await scope.machines.listProfileVersions(machine.id);
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
    expect((versions[0]?.profile as MachineProfile).tools).toHaveLength(2);
    expect(await toolRows(scope, machine.id)).toEqual([[3, 'compression', 10]]);
  });

  it('an invalid profile writes nothing', async () => {
    const before = (await scope.machines.list()).length;
    const bad = profile((x) => (x.table.width = -5));
    await expect(scope.machines.createWithProfile(bad)).rejects.toBeInstanceOf(
      InvalidMachineProfile,
    );
    expect((await scope.machines.list()).length).toBe(before);

    const { machine } = await scope.machines.createWithProfile(profile());
    const err = await scope.machines.saveProfile(machine.id, bad).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InvalidMachineProfile);
    expect((err as InvalidMachineProfile).issues).toContainEqual(
      expect.objectContaining({ path: 'table.width', code: 'too_small' }),
    );
    expect(await scope.machines.listProfileVersions(machine.id)).toHaveLength(1);
  });

  it('re-verification: a verified machine needs re-verification after a tool change', async () => {
    const created = await scope.machines.createWithProfile(profile());
    await scope.validations.create({
      machineProfileVersionId: created.version.id,
      toolSet: created.profile.tools,
      postVersion: created.version.postVersion,
      stage: 'verified',
    });
    expect((await scope.machines.getWithProfile(created.machine.id))?.state).toBe('verified');

    // A rename keeps the verification.
    const renamed = await scope.machines.saveProfile(created.machine.id, {
      ...created.profile,
      identity: { ...created.profile.identity, name: 'Atölye' },
    });
    expect(renamed.state).toBe('verified');

    // A tool change does not.
    const changed = await scope.machines.saveProfile(created.machine.id, {
      ...renamed.profile,
      tools: renamed.profile.tools.map((t) => (t.number === 1 ? { ...t, diameter: 6.35 } : t)),
    });
    expect(changed.state).toBe('reverify_needed');
    expect(
      (await scope.machines.listWithProfiles()).find((m) => m.machine.id === created.machine.id)
        ?.state,
    ).toBe('reverify_needed');
  });

  it('another company cannot read or save the profile', async () => {
    const { machine } = await scope.machines.createWithProfile(profile());
    expect(await other.machines.getWithProfile(machine.id)).toBeNull();
    await expect(other.machines.saveProfile(machine.id, profile())).rejects.toBeInstanceOf(
      NotFound,
    );
    expect((await other.machines.listWithProfiles()).map((m) => m.machine.id)).not.toContain(
      machine.id,
    );
    expect(await scope.machines.listProfileVersions(machine.id)).toHaveLength(1);
  });

  it('seedDefaultProfile adds the Mach3 example router as a draft (T020)', async () => {
    const fresh = forCompany(h.db, (await newCompany(h, 'Seed')).id);
    const seeded = await seedDefaultProfile(fresh);
    expect(seeded.machine.name).toBe(EXAMPLE_PROFILE_NAME);
    expect(seeded.profile.example).toBe(true);
    expect(seeded.profile.post).toEqual({ id: 'mach3', version: '1.0.0' });
    expect(seeded.profile.table).toEqual({ width: 3050, depth: 2150 });
    const list = await fresh.machines.listWithProfiles();
    expect(list.map((m) => [m.machine.name, m.state, m.version.version])).toEqual([
      [EXAMPLE_PROFILE_NAME, 'draft', 1],
    ]);
    // A fresh seed is not a legacy one: the upgrade does nothing.
    expect(await upgradeExampleProfile(fresh)).toEqual([]);
  });

  describe('upgradeExampleProfile (T020, D-028)', () => {
    async function legacyCompany(name: string, edit?: (p: MachineProfile) => void) {
      const c = forCompany(h.db, (await newCompany(h, name)).id);
      const p = defaultMachineProfile();
      edit?.(p);
      const m = await c.machines.createWithProfile(p);
      return { c, id: m.machine.id };
    }

    it('an untouched old seed gets the new example as version 2, once (idempotent)', async () => {
      const { c, id } = await legacyCompany('Legacy');
      const done = await upgradeExampleProfile(c);
      expect(done.map((m) => m.machine.id)).toEqual([id]);
      const versions = await c.machines.listProfileVersions(id);
      expect(versions.map((v) => v.version)).toEqual([1, 2]);
      // Append-only: version 1 is still the old profile.
      expect((versions[0]?.profile as { post: { id: string } }).post.id).toBe('generic');
      const now = await c.machines.getWithProfile(id);
      expect(now?.profile).toEqual(exampleMachineProfile());
      expect(now?.machine.name).toBe(EXAMPLE_PROFILE_NAME);
      expect(await upgradeExampleProfile(c)).toEqual([]);
      expect(await c.machines.listProfileVersions(id)).toHaveLength(2);
    });

    it('an old seed from before T017 (no rapid feed) is upgraded too', async () => {
      const { c, id } = await legacyCompany('Legacy pre-T017', (p) => {
        delete p.rapidFeed;
      });
      expect((await upgradeExampleProfile(c)).map((m) => m.machine.id)).toEqual([id]);
    });

    it('an edited old seed is left alone (changed value, or a second version)', async () => {
      const changed = await legacyCompany('Edited value', (p) => {
        p.safeZ = 25;
      });
      expect(await upgradeExampleProfile(changed.c)).toEqual([]);
      expect(await changed.c.machines.listProfileVersions(changed.id)).toHaveLength(1);

      const resaved = await legacyCompany('Edited version');
      await resaved.c.machines.saveProfile(resaved.id, defaultMachineProfile());
      expect(await upgradeExampleProfile(resaved.c)).toEqual([]);
      expect(await resaved.c.machines.listProfileVersions(resaved.id)).toHaveLength(2);
    });

    it('a non-example machine with the same values is left alone', async () => {
      const { c } = await legacyCompany('Not example', (p) => {
        p.example = false;
      });
      expect(await upgradeExampleProfile(c)).toEqual([]);
    });
  });

  it('companies.ensure creates once and then returns the same company', async () => {
    const id = randomUUID();
    const first = await companies.ensure(h.db, id, { name: 'Varsayılan' });
    const second = await companies.ensure(h.db, id, { name: 'ignored' });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.company).toEqual(first.company);
  });
});
