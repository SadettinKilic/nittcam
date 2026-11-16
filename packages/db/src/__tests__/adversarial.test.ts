/**
 * Tester (T008): adversarial checks on tenant isolation, revision lock, versions, storage keys and
 * migrations. Complements the dev tests; uses forged inputs a hostile caller could pass.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbHandle } from '../client';
import { schema } from '../index';
import { InvalidStorageKey, LocalFsStorage, storageForCompany } from '../storage';
import {
  forCompany,
  InvalidProject,
  NotFound,
  RevisionConflict,
  type CompanyScope,
} from '../tenant';
import { AT, loadFixture, newCompany, openTestDb } from './helpers';

let h: DbHandle;
let a: CompanyScope;
let b: CompanyScope;
let aId: string;
let bId: string;

beforeAll(async () => {
  h = await openTestDb();
  aId = (await newCompany(h, 'A')).id;
  bId = (await newCompany(h, 'B')).id;
  a = forCompany(h.db, aId);
  b = forCompany(h.db, bId);
});
afterAll(async () => {
  await h.close();
});

const fixture = () => loadFixture('shelf-set');
const countOf = (res: unknown): number => (res as { rows: { n: number }[] }).rows[0]?.n ?? -1;
const cmd = (n: number) => ({ command: 'noop', params: { n }, actor: 'user' as const, at: AT });

describe('forged inputs', () => {
  it("company B's project id passed to A: get/save/listCommands see nothing; B's row is unchanged", async () => {
    const pb = await b.projects.create({ name: 'B-secret', data: fixture() });
    const before = await b.projects.get(pb.id);

    expect(await a.projects.get(pb.id)).toBeNull();
    await expect(
      a.projects.save(pb.id, { revision: pb.revision, data: fixture(), name: 'HACKED' }),
    ).rejects.toBeInstanceOf(NotFound);
    expect(await a.projects.listCommands(pb.id)).toEqual([]);

    expect(await b.projects.get(pb.id)).toEqual(before);
  });

  it('forged save with commands against B does not write command rows', async () => {
    const pb = await b.projects.create({ name: 'B2', data: fixture() });
    await expect(
      a.projects.save(pb.id, { revision: 1, data: fixture(), commands: [cmd(1)] }),
    ).rejects.toThrow();
    const rows = await h.db.select().from(schema.projectCommands);
    expect(rows.filter((r) => r.projectId === pb.id)).toHaveLength(0);
    expect((await b.projects.get(pb.id))?.revision).toBe(1);
  });

  it('companyId / id / revision in a create payload are overwritten by the scope', async () => {
    const forged = await a.projects.create({
      name: 'forged',
      data: fixture(),
      companyId: bId,
      id: '00000000-0000-4000-8000-000000000000',
      revision: 99,
    } as never);
    expect(forged.companyId).toBe(aId);
    expect(forged.id).not.toBe('00000000-0000-4000-8000-000000000000');
    expect(forged.revision).toBe(1);
    expect(await b.projects.get(forged.id)).toBeNull();

    const m = await a.machines.create({ name: 'm', companyId: bId } as never);
    expect(m.companyId).toBe(aId);
    const moved = await a.machines.update(m.id, { companyId: bId, name: 'm2' } as never);
    expect(moved?.companyId).toBe(aId);
    expect(await b.machines.get(m.id)).toBeNull();
  });
});

describe('composite FK at the database level', () => {
  it("raw insert into project_commands for another company's project fails", async () => {
    const pb = await b.projects.create({ name: 'B3', data: fixture() });
    await expect(
      h.db.insert(schema.projectCommands).values({
        companyId: aId,
        projectId: pb.id,
        revision: 2,
        seq: 0,
        command: 'noop',
        params: {},
        actor: 'user',
        at: new Date(AT),
      }),
    ).rejects.toThrow();
  });
});

describe('revision lock under concurrency', () => {
  it('two concurrent saves from the same base revision: one wins, one RevisionConflict, no partial commands', async () => {
    const p = await a.projects.create({ name: 'race', data: fixture() });
    const results = await Promise.allSettled([
      a.projects.save(p.id, {
        revision: 1,
        data: fixture(),
        name: 'one',
        commands: [cmd(1), cmd(2)],
      }),
      a.projects.save(p.id, {
        revision: 1,
        data: fixture(),
        name: 'two',
        commands: [cmd(3), cmd(4)],
      }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const bad = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);
    expect((bad[0] as PromiseRejectedResult).reason).toBeInstanceOf(RevisionConflict);

    const row = await a.projects.get(p.id);
    expect(row?.revision).toBe(2);
    const cmds = await a.projects.listCommands(p.id);
    expect(cmds).toHaveLength(2);
    expect(new Set(cmds.map((c) => c.revision))).toEqual(new Set([2]));
    const winnerName = (ok[0] as PromiseFulfilledResult<{ name: string }>).value.name;
    expect(row?.name).toBe(winnerName);
  });
});

describe('profile versions', () => {
  it('3 versions give 1, 2, 3 and old JSON stays unchanged', async () => {
    const m = await a.machines.create({ name: 'adv-machine' });
    const input = (z: number) => ({
      profile: { safeZ: z, nested: { z } },
      postConfig: { dialect: 'generic' },
      postVersion: '1.0.0',
    });
    const v1 = await a.machines.addProfileVersion(m.id, input(10));
    const snapshot = JSON.stringify(v1.profile);
    const v2 = await a.machines.addProfileVersion(m.id, input(20));
    const v3 = await a.machines.addProfileVersion(m.id, input(30));
    expect([v1.version, v2.version, v3.version]).toEqual([1, 2, 3]);
    const list = await a.machines.listProfileVersions(m.id);
    expect(JSON.stringify(list[0]?.profile)).toBe(snapshot);
    expect(list.map((v) => v.version)).toEqual([1, 2, 3]);
    await expect(b.machines.addProfileVersion(m.id, input(1))).rejects.toBeInstanceOf(NotFound);
  });
});

describe('InvalidProject', () => {
  it('is thrown before the DB is touched (create and save)', async () => {
    const p = await a.projects.create({ name: 'valid', data: fixture() });
    const count = async () =>
      countOf(await h.db.execute(sql`select count(*)::int as n from projects`));
    const before = await count();
    await expect(a.projects.create({ name: 'bad', data: { nope: 1 } })).rejects.toBeInstanceOf(
      InvalidProject,
    );
    await expect(a.projects.create({ name: 'bad', data: null })).rejects.toBeInstanceOf(
      InvalidProject,
    );
    await expect(
      a.projects.save(p.id, { revision: 1, data: [], commands: [cmd(1)] }),
    ).rejects.toBeInstanceOf(InvalidProject);
    expect(await count()).toEqual(before);
    expect((await a.projects.get(p.id))?.revision).toBe(1);
    expect(await a.projects.listCommands(p.id)).toEqual([]);
  });
});

describe('storage keys', () => {
  it('rejects traversal, absolute, backslash and odd keys; tenants stay apart', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nittcam-adv-'));
    try {
      const fs = new LocalFsStorage(dir);
      const bad = [
        '../x',
        'a/../../x',
        'a/..',
        '/etc/passwd',
        'C:/x',
        'C:\\x',
        'a\\b',
        '..\\x',
        '',
        'a//b',
        './x',
        'a/./b',
        'a/',
        'a\0b',
      ];
      for (const key of bad) {
        await expect(fs.put(key, 'x'), JSON.stringify(key)).rejects.toBeInstanceOf(
          InvalidStorageKey,
        );
        await expect(fs.get(key)).rejects.toBeInstanceOf(InvalidStorageKey);
        await expect(fs.delete(key)).rejects.toBeInstanceOf(InvalidStorageKey);
      }
      const sa = storageForCompany(fs, 'company-a');
      const sb = storageForCompany(fs, 'company-b');
      await sa.put('exports/1.nc', 'A');
      await sb.put('exports/1.nc', 'B');
      await expect(sb.get('../company-a/exports/1.nc')).rejects.toBeInstanceOf(InvalidStorageKey);
      expect(new TextDecoder().decode((await sa.get('exports/1.nc')) as Uint8Array)).toBe('A');
      expect(await sa.list()).toEqual(['exports/1.nc']);
      await sb.delete('exports/1.nc');
      expect(await sa.get('exports/1.nc')).not.toBeNull();
      expect(() => storageForCompany(fs, '../company-a')).toThrow(InvalidStorageKey);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('migrations', () => {
  it('a fresh in-memory db migrates in under 5 s and a second run is a no-op', async () => {
    const t0 = performance.now();
    const fresh = await openTestDb();
    const ms = performance.now() - t0;
    try {
      expect(ms).toBeLessThan(5000);
      const count = async () =>
        countOf(
          await fresh.db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`),
        );
      const before = await count();
      await fresh.migrate();
      await fresh.migrate();
      expect(await count()).toEqual(before);
    } finally {
      await fresh.close();
    }
  });
});
