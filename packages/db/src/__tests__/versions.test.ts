import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbHandle } from '../client';
import { machineProfileVersions } from '../schema';
import { forCompany, type CompanyScope } from '../tenant';
import { newCompany, openTestDb } from './helpers';

let h: DbHandle;
let scope: CompanyScope;

beforeAll(async () => {
  h = await openTestDb();
  scope = forCompany(h.db, (await newCompany(h)).id);
});
afterAll(async () => {
  await h.close();
});

describe('immutable versions', () => {
  it('the repository API has no update path for versions', () => {
    expect(Object.keys(scope.machineProfileVersions).sort()).toEqual(['get', 'list']);
    expect(Object.keys(scope.templateVersions).sort()).toEqual(['get', 'list']);
    expect(Object.keys(scope.projectCommands).sort()).toEqual(['get', 'list']);
    for (const key of ['exports', 'validations', 'chatMessages'] as const) {
      expect(Object.keys(scope[key]).sort()).toEqual(['create', 'get', 'list']);
    }
    // Compile-time guard: these lines must not type-check.
    // @ts-expect-error no update on machine profile versions
    void scope.machineProfileVersions.update;
    // @ts-expect-error no update on template versions
    void scope.templateVersions.update;
  });

  it('addProfileVersion numbers versions per machine and keeps earlier ones unchanged', async () => {
    const m1 = await scope.machines.create({ name: 'M1' });
    const m2 = await scope.machines.create({ name: 'M2' });
    const v1 = await scope.machines.addProfileVersion(m1.id, {
      profile: { safeZ: 20 },
      postConfig: { dialect: 'generic' },
      postVersion: '1.0.0',
    });
    const v2 = await scope.machines.addProfileVersion(m1.id, {
      profile: { safeZ: 25 },
      postConfig: { dialect: 'generic' },
      postVersion: '1.1.0',
    });
    const other = await scope.machines.addProfileVersion(m2.id, {
      profile: {},
      postConfig: {},
      postVersion: '1.0.0',
    });
    expect([v1.version, v2.version, other.version]).toEqual([1, 2, 1]);
    expect(v2.id).not.toBe(v1.id);

    const list = await scope.machines.listProfileVersions(m1.id);
    expect(list.map((v) => [v.version, v.profile, v.postVersion])).toEqual([
      [1, { safeZ: 20 }, '1.0.0'],
      [2, { safeZ: 25 }, '1.1.0'],
    ]);
    expect(await scope.machineProfileVersions.get(v1.id)).toEqual(v1);
  });

  it('the database rejects a duplicate version number', async () => {
    const m = await scope.machines.create({ name: 'dup' });
    await scope.machines.addProfileVersion(m.id, { profile: {}, postConfig: {}, postVersion: '1' });
    await expect(
      h.db.insert(machineProfileVersions).values({
        companyId: scope.companyId,
        machineId: m.id,
        version: 1,
        profile: {},
        postConfig: {},
        postVersion: '1',
      }),
    ).rejects.toThrow();
  });

  it('template versions increment the same way', async () => {
    const t = await scope.templates.create({ name: 'Kapak' });
    const a = await scope.templates.addVersion(t.id, { params: { w: 400 }, geometry: {} });
    const b = await scope.templates.addVersion(t.id, { params: { w: 450 }, geometry: {} });
    expect([a.version, b.version]).toEqual([1, 2]);
    expect((await scope.templates.listVersions(t.id)).map((v) => v.params)).toEqual([
      { w: 400 },
      { w: 450 },
    ]);
  });
});
