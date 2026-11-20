/**
 * T175: GET /api/projects/:id/dxf against an in-memory PGlite database. The saved revision's DXF
 * equals `writeProjectDxf`, both kinds, ASCII file name, stale revision 409, deleted project 404,
 * no layout 422, bad query 400.
 */
import { applyCommand, nestingToolDiameter, writeProjectDxf, type Project } from '@nittcam/core';
import type { DbHandle } from '@nittcam/db';
import { afterAll, describe, expect, it } from 'vitest';
import { companyScope } from '../../../lib/server/company';
import { asciiStem, dxfFileName } from '../../../lib/server/dxf';
import type { ProjectDetail } from '../../../lib/projects-api';
import { POST as create } from './route';
import { PATCH as patch } from './[id]/route';
import { GET as dxf } from './[id]/dxf/route';

const json = (body: unknown, method = 'POST') =>
  new Request('http://test', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
const get = (id: string, q: string) => dxf(new Request(`http://test/x?${q}`), ctx({ id }));

async function project(nest: boolean): Promise<Project> {
  const scope = await companyScope();
  const [m] = await scope.machines.listWithProfiles();
  const set = m?.profile.materials[0];
  if (!m || !set) throw new Error('no seeded machine');
  let p = {
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
  const run = (name: string, params: unknown) => {
    const r = applyCommand(p, name, params);
    if (!r.ok) throw new Error(`${name}: ${r.error.message}`);
    p = r.project;
  };
  run('addPart', { id: 'kapak', name: 'Kapak', qty: 2, params: { w: 400, h: 600, r: 20 } });
  if (nest) run('runNesting', { toolDiameter: nestingToolDiameter(m.profile, p.stock) ?? 8 });
  return p;
}

async function created(name: string, p: Project): Promise<ProjectDetail> {
  const res = await create(json({ name, project: p }));
  expect(res.status).toBe(201);
  return (await res.json()) as ProjectDetail;
}

afterAll(async () => {
  const cache = globalThis as { nittcamDb?: Promise<DbHandle> };
  await (await cache.nittcamDb)?.close();
});

describe('GET /api/projects/:id/dxf (T175)', () => {
  it('returns the saved revision as DXF: layout and parts, ASCII name', async () => {
    const p = await project(true);
    const d = await created('Mutfak dolabı Çekmece', p);
    const layout = await get(d.id, `revision=${d.revision}&tur=dizilim`);
    expect(layout.status).toBe(200);
    expect(layout.headers.get('content-disposition')).toBe(
      `attachment; filename="Mutfak_dolabi_Cekmece_r${d.revision}_dizilim.dxf"`,
    );
    expect(await layout.text()).toBe(writeProjectDxf(p, 'layout'));
    const parts = await get(d.id, `revision=${d.revision}&tur=parcalar`);
    expect(parts.status).toBe(200);
    expect(await parts.text()).toBe(writeProjectDxf(p, 'parts'));
    // Same revision, same bytes.
    const again = await get(d.id, `revision=${d.revision}&tur=dizilim`);
    expect(again.headers.get('etag')).toBe(layout.headers.get('etag'));
  });

  it('refuses a stale revision, a bad query, a missing layout and a deleted project', async () => {
    const d = await created('Raf', await project(false));
    expect((await get(d.id, `revision=${d.revision + 1}`)).status).toBe(409);
    expect((await get(d.id, `revision=0`)).status).toBe(400);
    expect((await get(d.id, `revision=${d.revision}&tur=x`)).status).toBe(400);
    expect((await get(d.id, `revision=${d.revision}`)).status).toBe(422);
    expect((await get(d.id, `revision=${d.revision}&tur=parcalar`)).status).toBe(200);
    expect((await patch(json({ deleted: true }, 'PATCH'), ctx({ id: d.id }))).status).toBe(200);
    expect((await get(d.id, `revision=${d.revision}&tur=parcalar`)).status).toBe(404);
    expect((await get('not-a-uuid', 'revision=1')).status).toBe(404);
  });

  it('file names are ASCII', () => {
    expect(asciiStem('Şişli İş ğüöç')).toBe('Sisli_Is_guoc');
    expect(asciiStem('***')).toBe('proje');
    expect(dxfFileName('a/b', 3, 'parts')).toBe('a_b_r3_parcalar.dxf');
  });
});
