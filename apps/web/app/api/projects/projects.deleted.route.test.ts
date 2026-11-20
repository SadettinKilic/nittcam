/**
 * T178: "Silinenler" list and a deleted project's direct link, against an in-memory PGlite
 * database. GET ?silinen=1 lists only deleted projects; GET/PUT /:id of a deleted project → 410
 * with the name; export of a deleted project → 404; restore brings everything back.
 */
import type { Project } from '@nittcam/core';
import type { DbHandle } from '@nittcam/db';
import { afterAll, describe, expect, it } from 'vitest';
import { companyScope } from '../../../lib/server/company';
import type { ProjectDetail, ProjectListItem } from '../../../lib/projects-api';
import { GET as list, POST as create } from './route';
import { GET as getOne, PATCH as patch, PUT as save } from './[id]/route';
import { GET as preview } from './[id]/export/route';

const json = (body: unknown, method = 'POST') =>
  new Request('http://test', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

async function emptyProject(): Promise<Project> {
  const scope = await companyScope();
  const [m] = await scope.machines.listWithProfiles();
  const set = m?.profile.materials[0];
  if (!m || !set) throw new Error('no seeded machine');
  return {
    schemaVersion: 2,
    machine: { machineId: m.machine.id, profileVersion: m.version.version },
    stock: {
      material: set.material,
      thickness: set.thickness,
      sheet: { width: 2800, height: 2070, grain: 0 },
      useOffcuts: false,
    },
    parts: [],
    nesting: { mode: 'minWaste', gap: 8, margin: 10 },
    layout: { sheets: [] },
    cutting: { tabs: { auto: true }, leadIn: 'arc', direction: 'climb' },
    settings: { dimensionMode: 'cut' },
  } as unknown as Project;
}

afterAll(async () => {
  const cache = globalThis as { nittcamDb?: Promise<DbHandle> };
  await (await cache.nittcamDb)?.close();
});

const ids = async (q = '') =>
  (
    (await (await list(new Request(`http://test/api/projects${q}`))).json()) as ProjectListItem[]
  ).map((i) => i.id);

describe('deleted projects (T178)', () => {
  it('lists deleted projects apart, blocks their link and saves, restores', async () => {
    const p = await emptyProject();
    const res = await create(json({ name: 'Silinecek dolap', project: p }));
    const d = (await res.json()) as ProjectDetail;
    expect(await ids()).toContain(d.id);
    expect(await ids('?silinen=1')).not.toContain(d.id);

    expect((await patch(json({ deleted: true }, 'PATCH'), ctx({ id: d.id }))).status).toBe(200);
    expect(await ids()).not.toContain(d.id);
    const deleted = (await (
      await list(new Request('http://test/api/projects?silinen=1'))
    ).json()) as ProjectListItem[];
    const row = deleted.find((i) => i.id === d.id);
    expect(row?.deletedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(deleted.every((i) => i.deletedAt !== null)).toBe(true);

    const direct = await getOne(new Request('http://test'), ctx({ id: d.id }));
    expect(direct.status).toBe(410);
    expect(await direct.json()).toEqual({ error: 'deleted', name: 'Silinecek dolap' });
    const put = await save(
      json({ project: p, baseRevision: d.revision, commands: [] }, 'PUT'),
      ctx({ id: d.id }),
    );
    expect(put.status).toBe(410);
    const exp = await preview(
      new Request(`http://test/x?revision=${d.revision}`),
      ctx({ id: d.id }),
    );
    expect(exp.status).toBe(404);

    expect((await patch(json({ deleted: false }, 'PATCH'), ctx({ id: d.id }))).status).toBe(200);
    expect(await ids()).toContain(d.id);
    expect(await ids('?silinen=1')).not.toContain(d.id);
    expect((await getOne(new Request('http://test'), ctx({ id: d.id }))).status).toBe(200);
  });
});
