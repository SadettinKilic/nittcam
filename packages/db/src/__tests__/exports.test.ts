/**
 * T021 (D-030): idempotent project create on a client id, export records (insert once, the
 * unverified-acceptance constraint, newest per project), a specific profile version, the default
 * user, all tenant-scoped.
 */
import { exampleMachineProfile } from '@nittcam/core';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbHandle } from '../client';
import { forCompany, IdTaken, type CompanyScope, type NewExport } from '../tenant';
import { AT, loadFixture, newCompany, openTestDb } from './helpers';

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

describe('projects.createOnce (client-generated id)', () => {
  it('creates once; a repeat returns the stored project and writes nothing', async () => {
    const id = randomUUID();
    const data = loadFixture('shelf-set');
    const cmd = { command: 'setGrain', params: { grain: 0 }, actor: 'user' as const, at: AT };
    const first = await a.projects.createOnce({ id, name: 'Raf', data, commands: [cmd] });
    expect(first.created).toBe(true);
    expect(first.row.id).toBe(id);
    const again = await a.projects.createOnce({ id, name: 'Başka', data, commands: [cmd] });
    expect(again.created).toBe(false);
    expect(again.row.name).toBe('Raf');
    expect(await a.projects.listCommands(id)).toHaveLength(1);
  });

  it("another company's id is refused without revealing the row", async () => {
    const id = randomUUID();
    await a.projects.createOnce({ id, name: 'A', data: loadFixture('mixed') });
    await expect(
      b.projects.createOnce({ id, name: 'B', data: loadFixture('mixed') }),
    ).rejects.toBeInstanceOf(IdTaken);
    expect(await b.projects.get(id)).toBeNull();
    expect((await a.projects.get(id))?.name).toBe('A');
  });
});

describe('exports', () => {
  async function setup(scope: CompanyScope) {
    const m = await scope.machines.createWithProfile(exampleMachineProfile());
    const p = await scope.projects.create({ name: 'P', data: loadFixture('shelf-set') });
    const user = await scope.users.ensureDefault({
      email: `u-${randomUUID()}@test.local`,
      name: 'U',
    });
    return { m, p, user };
  }
  function values(s: Awaited<ReturnType<typeof setup>>, over: Partial<NewExport> = {}): NewExport {
    return {
      projectId: s.p.id,
      projectRevision: 1,
      machineProfileVersionId: s.m.version.id,
      postId: 'mach3',
      postVersion: '1.0.0',
      kind: 'nc',
      fileKey: 'exports/x',
      sha256: 'a'.repeat(64),
      files: [
        { name: 'P_S1.tap', key: 'exports/x/P_S1.tap', size: 3, sha256: 'b'.repeat(64), sheet: 0 },
      ],
      validationStage: 'draft',
      verificationState: 'draft',
      unverified: true,
      acceptedUnverifiedAt: new Date(AT),
      acceptedBy: s.user.id,
      createdBy: s.user.id,
      ...over,
    };
  }

  it('createOnce is idempotent on (project, revision, profile version, post, kind, hash)', async () => {
    const s = await setup(a);
    const first = await a.exports.createOnce({ id: randomUUID(), ...values(s) });
    expect(first.created).toBe(true);
    const again = await a.exports.createOnce({ id: randomUUID(), ...values(s) });
    expect(again.created).toBe(false);
    expect(again.row.id).toBe(first.row.id);
    const other = await a.exports.createOnce(values(s, { sha256: 'c'.repeat(64) }));
    expect(other.created).toBe(true);
    expect(await a.exports.listForProject(s.p.id)).toHaveLength(2);
    expect(first.row.files[0]?.name).toBe('P_S1.tap');
  });

  it('an unverified export without acceptance is rejected by the database', async () => {
    const s = await setup(a);
    await expect(
      a.exports.createOnce(values(s, { acceptedUnverifiedAt: null, acceptedBy: null })),
    ).rejects.toThrow();
    const verified = await a.exports.createOnce(
      values(s, { unverified: false, acceptedUnverifiedAt: null, acceptedBy: null }),
    );
    expect(verified.created).toBe(true);
  });

  it('latestPerProject returns the newest export of each project; tenants stay apart', async () => {
    const s = await setup(a);
    await a.exports.createOnce(values(s, { sha256: '1'.repeat(64) }));
    const newer = await a.exports.createOnce(
      values(s, { projectRevision: 2, sha256: '2'.repeat(64) }),
    );
    const latest = await a.exports.latestPerProject();
    expect(latest.find((e) => e.projectId === s.p.id)?.id).toBe(newer.row.id);
    expect(await b.exports.get(newer.row.id)).toBeNull();
    expect(await b.exports.listForProject(s.p.id)).toEqual([]);
    expect((await b.exports.latestPerProject()).some((e) => e.projectId === s.p.id)).toBe(false);
  });

  it("an export cannot point at another company's user as acceptor", async () => {
    const s = await setup(a);
    const other = await b.users.ensureDefault({ email: `o-${randomUUID()}@test.local`, name: 'O' });
    await expect(
      a.exports.createOnce(values(s, { sha256: 'd'.repeat(64), acceptedBy: other.id })),
    ).rejects.toThrow();
  });
});

describe('machines.getProfileVersion', () => {
  it('loads a specific version by number or id, not the latest', async () => {
    const m = await a.machines.createWithProfile(exampleMachineProfile());
    const edited = exampleMachineProfile();
    edited.identity.name = 'Yeni ad';
    await a.machines.saveProfile(m.machine.id, edited);
    const v1 = await a.machines.getProfileVersion(m.machine.id, { version: 1 });
    expect(v1?.version.version).toBe(1);
    expect(v1?.profile.identity.name).toBe(m.profile.identity.name);
    expect(v1?.state).toBe('draft');
    const byId = await a.machines.getProfileVersion(m.machine.id, { id: m.version.id });
    expect(byId?.version.id).toBe(m.version.id);
    expect(await a.machines.getProfileVersion(m.machine.id, { version: 9 })).toBeNull();
    expect(await b.machines.getProfileVersion(m.machine.id, { version: 1 })).toBeNull();
  });
});

describe('users.ensureDefault', () => {
  it('creates the first user once and returns it afterwards', async () => {
    const c = forCompany(h.db, (await newCompany(h, 'C')).id);
    const email = `d-${randomUUID()}@test.local`;
    const u1 = await c.users.ensureDefault({ email, name: 'Varsayılan' });
    const u2 = await c.users.ensureDefault({ email, name: 'Varsayılan' });
    expect(u2.id).toBe(u1.id);
    expect(u1.role).toBe('admin');
    expect(await c.users.list()).toHaveLength(1);
  });
});
