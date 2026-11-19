import { DEFAULT_LIBRARY } from '@nittcam/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { forCompany, InvalidMaterial, type CompanyScope, type DbHandle } from '../index';
import { newCompany, openTestDb } from './helpers';

const entry = {
  kind: 'plywood',
  name: 'Huş kontrplak',
  thicknesses: [18, 12],
  tone: 'oak',
  grain: 90,
  sheetSizes: [{ width: 2500, height: 1250 }],
};

describe('material library repository (T121)', () => {
  let handle: DbHandle;
  let a: CompanyScope;
  let b: CompanyScope;

  beforeAll(async () => {
    handle = await openTestDb();
    a = forCompany(handle.db, (await newCompany(handle, 'A')).id);
    b = forCompany(handle.db, (await newCompany(handle, 'B')).id);
  });
  afterAll(async () => handle.close());

  it('seeds the default library once per company', async () => {
    expect(await a.materials.seedDefaults()).toBe(DEFAULT_LIBRARY.length);
    expect(await a.materials.seedDefaults()).toBe(0);
    const names = (await a.materials.list()).map((m) => m.name).sort();
    expect(names).toEqual(['Akrilik', 'Kontrplak', 'MDF', 'Melamin']);
    expect(await b.materials.list()).toEqual([]);
  });

  it('never re-seeds a company that deleted every entry (D-044, server restart)', async () => {
    const c = forCompany(handle.db, (await newCompany(handle, 'C')).id);
    expect(await c.materials.seedDefaults()).toBe(DEFAULT_LIBRARY.length);
    for (const m of await c.materials.list()) await c.materials.remove(m.id);
    expect(await c.materials.list()).toEqual([]);
    // A restart = a fresh scope on the same database.
    const again = forCompany(handle.db, c.companyId);
    expect(await again.materials.seedDefaults()).toBe(0);
    expect(await again.materials.list()).toEqual([]);
  });

  it('a company that already has entries is marked seeded without getting defaults', async () => {
    const d = forCompany(handle.db, (await newCompany(handle, 'D')).id);
    await d.materials.create(entry);
    expect(await d.materials.seedDefaults()).toBe(0);
    await d.materials.remove((await d.materials.list())[0]?.id ?? '');
    expect(await d.materials.seedDefaults()).toBe(0);
    expect(await d.materials.list()).toEqual([]);
  });

  it('creates, updates and removes an entry; values are normalised by core', async () => {
    const row = await a.materials.create(entry);
    expect(row.thicknesses).toEqual([12, 18]);
    const updated = await a.materials.update(row.id, { name: 'Huş 18', grain: null });
    expect(updated).toMatchObject({ name: 'Huş 18', grain: null, thicknesses: [12, 18] });
    expect(await a.materials.remove(row.id)).toBe(true);
    expect(await a.materials.get(row.id)).toBeNull();
    expect(await a.materials.remove(row.id)).toBe(false);
  });

  it('rejects invalid entries with InvalidMaterial and writes nothing', async () => {
    const before = (await a.materials.list()).length;
    await expect(a.materials.create({ ...entry, thicknesses: [] })).rejects.toBeInstanceOf(
      InvalidMaterial,
    );
    const row = await a.materials.create(entry);
    await expect(a.materials.update(row.id, { sheetSizes: [] })).rejects.toBeInstanceOf(
      InvalidMaterial,
    );
    expect((await a.materials.get(row.id))?.sheetSizes).toEqual(entry.sheetSizes);
    expect((await a.materials.list()).length).toBe(before + 1);
  });

  it('company isolation: B cannot read, update or remove A entries', async () => {
    const row = await a.materials.create(entry);
    expect(await b.materials.get(row.id)).toBeNull();
    expect(await b.materials.update(row.id, { name: 'hijacked' })).toBeNull();
    expect(await b.materials.remove(row.id)).toBe(false);
    expect((await a.materials.get(row.id))?.name).toBe(entry.name);
    expect((await b.materials.list()).map((m) => m.id)).not.toContain(row.id);
  });
});
