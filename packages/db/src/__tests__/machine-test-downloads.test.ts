/**
 * T191 (D-088): test-program downloads are recorded on the machine (`machines.test_downloads`,
 * migration 0013): newest first, a repeat of the same file is one entry, bounded, tenant-scoped.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbHandle } from '../client';
import { seedDefaultProfile } from '../seed';
import { forCompany, parseTestDownloads, TEST_DOWNLOADS_MAX, type CompanyScope } from '../tenant';
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

const entry = (name: string, sha256 = 'aa', at = '2026-11-20T10:00:00.000Z') => ({
  kind: 'airCut',
  name,
  sha256,
  version: 1,
  at,
});

describe('machine test downloads (T191)', () => {
  it('starts empty, newest first, a repeated file is one entry', async () => {
    const { machine } = await seedDefaultProfile(a);
    expect(await a.machines.testDownloads(machine.id)).toEqual([]);
    expect(await a.machines.recordTestDownload(machine.id, entry('AIRCUT.tap'))).toBe(true);
    await a.machines.recordTestDownload(machine.id, entry('TESTPARCA.tap', 'bb'));
    await a.machines.recordTestDownload(
      machine.id,
      entry('TESTPARCA.tap', 'bb', '2026-11-20T11:00:00.000Z'),
    );
    const log = await a.machines.testDownloads(machine.id);
    expect(log?.map((e) => e.name)).toEqual(['TESTPARCA.tap', 'AIRCUT.tap']);
    expect(log?.[0]?.at).toBe('2026-11-20T11:00:00.000Z');
  });

  it('is bounded', async () => {
    const { machine } = await seedDefaultProfile(a);
    for (let i = 0; i < TEST_DOWNLOADS_MAX + 3; i++) {
      await a.machines.recordTestDownload(machine.id, entry(`F${i}.tap`, String(i)));
    }
    const log = await a.machines.testDownloads(machine.id);
    expect(log).toHaveLength(TEST_DOWNLOADS_MAX);
    expect(log?.[0]?.name).toBe(`F${TEST_DOWNLOADS_MAX + 2}.tap`);
  });

  it("another company's machine is not found", async () => {
    const { machine } = await seedDefaultProfile(a);
    expect(await b.machines.testDownloads(machine.id)).toBeNull();
    expect(await b.machines.recordTestDownload(machine.id, entry('X.tap'))).toBe(false);
  });

  it('skips stored entries of another shape', () => {
    expect(parseTestDownloads([entry('A.tap'), { name: 1 }, null])).toHaveLength(1);
    expect(parseTestDownloads('x')).toEqual([]);
  });
});
