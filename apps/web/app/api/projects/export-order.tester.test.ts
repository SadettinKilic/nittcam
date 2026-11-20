/**
 * Tester (B41, T297, D-072): the NC export gate order with no flags at all. A stale revision is a
 * 409 and a failing project a 422 before any checklist question; the checklist (428
 * `checklist_required`) comes before the acceptance (428 `acceptance_required`); nothing is stored
 * until both are given. A verified-looking request without the checklist is never a file.
 */
import { applyCommand, nestingToolDiameter, type Project } from '@nittcam/core';
import type { DbHandle } from '@nittcam/db';
import { afterAll, describe, expect, it } from 'vitest';
import { companyScope } from '../../../lib/server/company';
import type { ProjectDetail } from '../../../lib/projects-api';
import { POST as create } from './route';
import { PUT as save } from './[id]/route';
import { POST as doExport } from './[id]/export/route';

const post = (body: unknown, method = 'POST') =>
  new Request('http://test', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function nestedProject(over: (p: Project) => Project = (p) => p): Promise<Project> {
  const scope = await companyScope();
  const [m] = await scope.machines.listWithProfiles();
  if (!m) throw new Error('no seeded machine');
  const set = m.profile.materials[0];
  if (!set) throw new Error('no material set');
  let p: Project = over({
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
  } as Project);
  const run = (name: string, params: unknown) => {
    const r = applyCommand(p, name, params);
    if (!r.ok) throw new Error(`${name}: ${r.error.message}`);
    p = r.project;
  };
  run('addPart', { id: 'raf', name: 'Raf', qty: 2, params: { w: 500, h: 300, r: 0 } });
  run('runNesting', { toolDiameter: nestingToolDiameter(m.profile, p.stock) ?? 8 });
  return p;
}

async function createProject(name: string, project: Project): Promise<ProjectDetail> {
  const res = await create(post({ name, project }));
  expect(res.status).toBe(201);
  return (await res.json()) as ProjectDetail;
}

const stored = async (id: string) => (await companyScope()).exports.listForProject(id);
const errorOf = async (r: Response) => ((await r.json()) as { error: string }).error;

afterAll(async () => {
  const cache = globalThis as { nittcamDb?: Promise<DbHandle> };
  await (await cache.nittcamDb)?.close();
});

describe('NC export gate order (tester, T297)', () => {
  it('stale revision without any flag → 409, not a checklist question', async () => {
    const project = await nestedProject();
    const d = await createProject('Sıra eski', project);
    expect(
      (await save(post({ project, baseRevision: 1, commands: [] }, 'PUT'), ctx(d.id))).status,
    ).toBe(200);
    const r = await doExport(post({ revision: 1 }), ctx(d.id));
    expect(r.status).toBe(409);
    expect(await errorOf(r)).toBe('conflict');
    expect(await stored(d.id)).toEqual([]);
  });

  it('failing project without any flag → 422, not a checklist question', async () => {
    const bad = await nestedProject((p) => ({
      ...p,
      stock: { ...p.stock, material: 'akrilik', thickness: 3 },
    }));
    const d = await createProject('Sıra hatalı', bad);
    const r = await doExport(post({ revision: 1 }), ctx(d.id));
    expect(r.status).toBe(422);
    expect(await errorOf(r)).toBe('export_failed');
    expect(await stored(d.id)).toEqual([]);
  });

  it('valid project: checklist first, then acceptance, then the file', async () => {
    const d = await createProject('Sıra geçerli', await nestedProject());
    const none = await doExport(post({ revision: 1 }), ctx(d.id));
    expect(none.status).toBe(428);
    expect(await errorOf(none)).toBe('checklist_required');
    // Acceptance alone does not skip the checklist.
    const acceptOnly = await doExport(post({ revision: 1, acceptUnverified: true }), ctx(d.id));
    expect(acceptOnly.status).toBe(428);
    expect(await errorOf(acceptOnly)).toBe('checklist_required');
    const listOnly = await doExport(post({ revision: 1, checklistConfirmed: true }), ctx(d.id));
    expect(listOnly.status).toBe(428);
    expect(await errorOf(listOnly)).toBe('acceptance_required');
    expect(await stored(d.id)).toEqual([]);
    const ok = await doExport(
      post({ revision: 1, checklistConfirmed: true, acceptUnverified: true }),
      ctx(d.id),
    );
    expect(ok.status).toBe(201);
    expect(await stored(d.id)).toHaveLength(1);
  });
});
