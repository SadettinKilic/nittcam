/**
 * T178 (delete part): soft delete hides a project from `list` (Projeler, Ana sayfa) and keeps its
 * data and command log; restore brings it back; tenant-scoped like the T151 template archive.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbHandle } from '../client';
import { forCompany, type CompanyScope } from '../tenant';
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

describe('projects.setDeleted (T178)', () => {
  it('hides from list, keeps data and commands, restores', async () => {
    const cmd = { command: 'setGrain', params: { grain: 0 }, actor: 'user' as const, at: AT };
    const p = await a.projects.create({
      name: 'Silinecek',
      data: loadFixture('shelf-set'),
      commands: [cmd],
    });
    const deleted = await a.projects.setDeleted(p.id, true);
    expect(deleted?.deletedAt).toBeInstanceOf(Date);
    expect(deleted?.revision).toBe(p.revision);
    expect((await a.projects.list()).map((r) => r.id)).not.toContain(p.id);
    // kept: the project itself and its command log
    expect((await a.projects.get(p.id))?.name).toBe('Silinecek');
    expect(await a.projects.listCommands(p.id)).toHaveLength(1);

    const restored = await a.projects.setDeleted(p.id, false);
    expect(restored?.deletedAt).toBeNull();
    expect((await a.projects.list()).map((r) => r.id)).toContain(p.id);
  });

  it('another company cannot delete or restore the project', async () => {
    const p = await a.projects.create({ name: 'A projesi', data: loadFixture('shelf-set') });
    expect(await b.projects.setDeleted(p.id, true)).toBeNull();
    expect((await a.projects.list()).map((r) => r.id)).toContain(p.id);
    await a.projects.setDeleted(p.id, true);
    expect(await b.projects.setDeleted(p.id, false)).toBeNull();
    expect((await a.projects.list()).map((r) => r.id)).not.toContain(p.id);
  });
});
