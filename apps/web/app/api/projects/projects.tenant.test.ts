/**
 * T023 tester: the route handlers only ever work in the default company. A project of another
 * company (inserted through the db repository) cannot be read, saved or copied: 404.
 */
import type { Project } from '@nittcam/core';
import { companies, forCompany, type DbHandle } from '@nittcam/db';
import { afterAll, describe, expect, it } from 'vitest';
import { companyScope } from '../../../lib/server/company';
import type { ProjectDetail, ProjectListItem } from '../../../lib/projects-api';
import { GET as list } from './route';
import { GET as get, PUT as save } from './[id]/route';
import { POST as copy } from './[id]/copy/route';

function project(thickness = 18): Project {
  return {
    schemaVersion: 2,
    machine: { machineId: 'draft', profileVersion: 1 },
    stock: {
      material: 'mdf',
      thickness,
      sheet: { width: 2800, height: 2070, grain: 0 },
      useOffcuts: false,
    },
    parts: [],
    nesting: { mode: 'minWaste', gap: 8, margin: 10 },
    layout: { sheets: [] },
    cutting: { tabs: { auto: true }, leadIn: 'arc', direction: 'climb' },
    settings: { dimensionMode: 'cut' },
  } as Project;
}
const put = (body: unknown) =>
  new Request('http://test', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const post = (body: unknown) =>
  new Request('http://test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

afterAll(async () => {
  const cache = globalThis as { nittcamDb?: Promise<{ close(): Promise<void> }> };
  await (await cache.nittcamDb)?.close();
});

describe('/api/projects multi-tenancy', () => {
  it('another company project is invisible and unwritable through the routes', async () => {
    await companyScope(); // opens the shared handle and the default company
    const handle = await (globalThis as { nittcamDb?: Promise<DbHandle> }).nittcamDb;
    if (!handle) throw new Error('no db handle');
    const otherId = '00000000-0000-4000-8000-0000000000aa';
    await companies.ensure(handle.db, otherId, { name: 'Başka atölye' });
    const other = forCompany(handle.db, otherId);
    const foreign = await other.projects.create({ name: 'Yabancı', data: project(), commands: [] });

    expect((await get(new Request('http://test'), ctx(foreign.id))).status).toBe(404);
    const saveRes = await save(
      put({ project: project(25), baseRevision: 1, commands: [], name: 'Çalındı' }),
      ctx(foreign.id),
    );
    expect(saveRes.status).toBe(404);
    expect((await copy(post({ name: 'Kopya' }), ctx(foreign.id))).status).toBe(404);
    const items = (await (await list()).json()) as ProjectListItem[];
    expect(items.some((i) => i.id === foreign.id)).toBe(false);

    // The foreign project is untouched, and no copy leaked into either company.
    const still = await other.projects.get(foreign.id);
    expect(still?.revision).toBe(1);
    expect(still?.name).toBe('Yabancı');
    expect(still?.data.stock.thickness).toBe(18);
    const mine = await companyScope();
    expect((await mine.projects.list()).some((p) => p.name === 'Kopya')).toBe(false);
    expect((await other.projects.list()).map((p) => p.name)).toEqual(['Yabancı']);

    // A project created through the routes belongs to the default company only.
    const created = (await (
      await (await import('./route')).POST(post({ name: 'Benim', project: project() }))
    ).json()) as ProjectDetail;
    expect(await other.projects.get(created.id)).toBeNull();
  });
});
