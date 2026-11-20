/**
 * B12a tester (T265): the server export refuses a project whose stock resolves to an `unverified`
 * parameter set (fix-flow starting values), even with `acceptUnverified` (that flag is about the
 * machine's verification state, not the parameter set). The mark survives the machine API round
 * trip; confirming it (mark removed, new profile version) makes the same project export.
 */
import {
  applyCommand,
  nestingToolDiameter,
  type MachineProfile,
  type Project,
} from '@nittcam/core';
import type { DbHandle } from '@nittcam/db';
import { afterAll, describe, expect, it } from 'vitest';
import { companyScope } from '../../../lib/server/company';
import type { MachineDetail } from '../../../lib/machines-api';
import type { ProjectDetail } from '../../../lib/projects-api';
import { POST as createMachine } from '../machines/route';
import { PUT as saveMachine } from '../machines/[id]/route';
import { POST as create } from './route';
import { POST as doExport } from './[id]/export/route';

const req = (method: string, body: unknown) =>
  new Request('http://test', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

afterAll(async () => {
  const cache = globalThis as { nittcamDb?: Promise<DbHandle> };
  await (await cache.nittcamDb)?.close();
});

function projectOn(machine: MachineDetail, set: { material: string; thickness: number }): Project {
  let p = {
    schemaVersion: 2,
    machine: { machineId: machine.id, profileVersion: machine.version },
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
  } as Project;
  const run = (name: string, params: unknown) => {
    const r = applyCommand(p, name, params);
    if (!r.ok) throw new Error(r.error.message);
    p = r.project;
  };
  run('addPart', { id: 'a', name: 'A', qty: 2, params: { w: 400, h: 600, r: 0 } });
  run('runNesting', { toolDiameter: nestingToolDiameter(machine.profile, p.stock) ?? 8 });
  return p;
}

async function exportOf(p: Project) {
  const res = await create(req('POST', { name: 'Doğrulanmamış ayar', project: p }));
  expect(res.status).toBe(201);
  const d = (await res.json()) as ProjectDetail;
  const ex = await doExport(
    req('POST', { revision: d.revision, acceptUnverified: true, checklistConfirmed: true }),
    ctx({ id: d.id }),
  );
  const scope = await companyScope();
  return {
    status: ex.status,
    body: JSON.stringify(await ex.json()),
    stored: await scope.exports.listForProject(d.id),
  };
}

describe('B12a tester: unverified parameter set at the export API (T265)', () => {
  it('marked set → 422 CUTTING_PARAMS_UNVERIFIED, nothing stored; confirmed → 201', async () => {
    const scope = await companyScope();
    const [seeded] = await scope.machines.listWithProfiles();
    if (!seeded) throw new Error('no seeded machine');
    const profile = structuredClone(seeded.profile) as MachineProfile;
    profile.example = false;
    profile.identity = { ...profile.identity, name: `B12a doğrulanmamış ${Date.now()}` };
    const set = profile.materials[0];
    if (!set) throw new Error('no set');
    profile.materials[0] = { ...set, unverified: true };

    const res = await createMachine(req('POST', { profile }));
    expect(res.status).toBe(201);
    const machine = (await res.json()) as MachineDetail;
    expect(machine.profile.materials[0]?.unverified).toBe(true);

    const blocked = await exportOf(projectOn(machine, set));
    expect(blocked.status).toBe(422);
    expect(blocked.body).toMatch(/CUTTING_PARAMS_UNVERIFIED/);
    expect(blocked.body).toMatch(/doğrulanmadı/);
    expect(blocked.stored).toEqual([]);

    // Confirm (the form drops the mark) → new version; a project on it exports.
    const confirmed = structuredClone(machine.profile);
    delete confirmed.materials[0]?.unverified;
    const put = await saveMachine(req('PUT', { profile: confirmed }), ctx({ id: machine.id }));
    expect(put.status).toBe(200);
    const next = (await put.json()) as MachineDetail;
    expect(next.profile.materials[0]?.unverified).toBeUndefined();
    const ok = await exportOf(projectOn(next, set));
    expect(ok.status).toBe(201);
    expect(ok.stored).toHaveLength(1);
  });
});
