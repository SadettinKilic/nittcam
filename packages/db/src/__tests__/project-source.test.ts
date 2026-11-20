/**
 * T292: a project split off from another stores its source; `links` lists the live source and the
 * live split-off projects; tenant-scoped (another company's id cannot be a source).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbHandle } from '../client';
import { forCompany, type CompanyScope } from '../tenant';
import { loadFixture, newCompany, openTestDb } from './helpers';

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

describe('projects source link (T292)', () => {
  it('links both ways; a deleted project drops out of the links', async () => {
    const data = loadFixture('shelf-set');
    const src = await a.projects.create({ name: 'Mutfak', data });
    const back = await a.projects.create({ name: 'Mutfak · 8 mm', data, sourceProjectId: src.id });
    const once = await a.projects.createOnce({
      id: '00000000-0000-4000-8000-00000000a292',
      name: 'Mutfak · 4 mm',
      data,
      sourceProjectId: src.id,
    });
    expect(back.sourceProjectId).toBe(src.id);
    expect(once.row.sourceProjectId).toBe(src.id);

    const links = await a.projects.links(src.id);
    expect(links.source).toBeNull();
    // oldest first; ties (same millisecond) fall back to the id, so compare as a set here
    expect(links.derived).toHaveLength(2);
    expect(links.derived).toEqual(
      expect.arrayContaining([
        { id: back.id, name: 'Mutfak · 8 mm' },
        { id: once.row.id, name: 'Mutfak · 4 mm' },
      ]),
    );
    expect(await a.projects.links(back.id)).toEqual({
      source: { id: src.id, name: 'Mutfak' },
      derived: [],
    });

    await a.projects.setDeleted(back.id, true);
    expect((await a.projects.links(src.id)).derived.map((l) => l.id)).toEqual([once.row.id]);
    await a.projects.setDeleted(src.id, true);
    expect((await a.projects.links(once.row.id)).source).toBeNull();
  });

  it('another company sees no links and cannot use a foreign source', async () => {
    const data = loadFixture('shelf-set');
    const src = await a.projects.create({ name: 'A kaynak', data });
    await a.projects.create({ name: 'A ayrı', data, sourceProjectId: src.id });
    expect(await b.projects.links(src.id)).toEqual({ source: null, derived: [] });
    // the composite foreign key rejects a source of another company
    await expect(b.projects.create({ name: 'B', data, sourceProjectId: src.id })).rejects.toThrow();
  });
});
