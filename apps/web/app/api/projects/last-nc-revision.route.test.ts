/**
 * T303 (CTO #12 on T296): GET /api/projects/:id says the newest NC file's revision, so a project
 * changed after "üretildi" is not shown as a silent "üretildi".
 */
import { applyCommand, nestingToolDiameter, type Project } from '@nittcam/core';
import type { DbHandle } from '@nittcam/db';
import { afterAll, describe, expect, it } from 'vitest';
import type { ProjectDetail } from '../../../lib/projects-api';
import { companyScope } from '../../../lib/server/company';
import { POST as create } from './route';
import { GET as get, PUT as put } from './[id]/route';
import { POST as doExport } from './[id]/export/route';

const json = (method: string, body: unknown) =>
  new Request('http://test', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

async function project(): Promise<{ p: Project }> {
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
  run('addPart', { id: 'raf', name: 'Raf', qty: 2, params: { w: 600, h: 400, r: 0 } });
  run('runNesting', { toolDiameter: nestingToolDiameter(m.profile, p.stock) ?? 8 });
  return { p };
}

afterAll(async () => {
  const cache = globalThis as { nittcamDb?: Promise<DbHandle> };
  await (await cache.nittcamDb)?.close();
});

describe('last NC revision on the project (T303)', () => {
  it('null before NC, the NC revision after, and stays when the project is saved again', async () => {
    const { p } = await project();
    const d = (await (
      await create(json('POST', { name: 'Kapaklar', project: p }))
    ).json()) as ProjectDetail;
    const id = d.id;
    const detail = async () =>
      (await (await get(new Request('http://test'), ctx({ id }))).json()) as ProjectDetail;
    expect((await detail()).lastNcRevision).toBeNull();
    const res = await doExport(
      json('POST', { revision: d.revision, acceptUnverified: true, checklistConfirmed: true }),
      ctx({ id }),
    );
    expect(res.status).toBe(201);
    expect(await detail()).toMatchObject({ status: 'produced', lastNcRevision: d.revision });
    const moved = { ...p, nesting: { ...p.nesting, gap: 12 } };
    expect(
      (await put(json('PUT', { baseRevision: d.revision, project: moved }), ctx({ id }))).status,
    ).toBe(200);
    expect(await detail()).toMatchObject({
      status: 'produced',
      revision: d.revision + 1,
      lastNcRevision: d.revision,
    });
  });
});
