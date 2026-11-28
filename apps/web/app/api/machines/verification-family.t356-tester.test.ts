/**
 * B72 tester (T356, D-138, CTO #15 rider): the job sees the machine's state in its own material
 * family at the export API; the ACM tray programs need the acceptance on direct calls; other
 * companies' machines stay invisible.
 */
import { randomUUID } from 'node:crypto';
import {
  applyCommand,
  nestingToolDiameter,
  type MachineProfile,
  type Project,
} from '@nittcam/core';
import { companies, forCompany, type DbHandle } from '@nittcam/db';
import { afterAll, describe, expect, it } from 'vitest';
import { companyScope } from '../../../lib/server/company';
import { acmTrayPdfProject } from '../../../lib/server/pdf/pdf.testing';
import type { ExportResponse } from '../../../lib/exports-api';
import type { ProjectDetail } from '../../../lib/projects-api';
import type { VerificationOverview, VerificationResponse } from '../../../lib/verification-api';
import { POST as createProject } from '../projects/route';
import { POST as doExport } from '../projects/[id]/export/route';
import { GET as fileOf } from '../exports/[id]/files/[name]/route';
import { GET as download } from './[id]/verification/[kind]/[name]/route';
import { GET as overview, POST as record } from './[id]/verification/route';

const CHECKS = { axes: true, spindle: true, safeZ: true, noContact: true };
const json = (method: string, body: unknown) =>
  new Request('http://test', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
const UNVERIFIED_LINE = /DOGRULANMAMIS MALZEME: ACM/;
const DRAFT_HEADER = /DO[GĞ]RULANMADI, [oö]nce air cut/;

afterAll(async () => {
  const cache = globalThis as { nittcamDb?: Promise<DbHandle> };
  await (await cache.nittcamDb)?.close();
});

/** The seeded machine plus an ACM 4 mm set (flat end mill) and a 90° V-bit T7 (as the dev test). */
function acmProfile(p: MachineProfile): MachineProfile {
  p = structuredClone(p);
  p.example = false;
  p.identity.name = `ACM tester ${randomUUID().slice(0, 6)}`;
  const base = p.materials[0];
  const flat = p.tools.find((t) => t.type === 'flatEndMill');
  if (!base || !flat) throw new Error('seed has no set or flat end mill');
  p.materials = [
    ...p.materials,
    { ...base, material: 'acm', thickness: 4, tool: flat.number, stepDown: 2, tabs: undefined },
  ];
  p.tools = [
    ...p.tools.filter((t) => t.number !== 7),
    {
      number: 7,
      type: 'vBit',
      diameter: 12,
      fluteLength: 8,
      flutes: 2,
      angleDeg: 90,
      tipDiameter: 0.2,
    },
  ];
  if (p.toolChanger.type === 'auto') p.toolChanger = { ...p.toolChanger, capacity: 8 };
  return p;
}

async function acmMachine() {
  const scope = await companyScope();
  const [seeded] = await scope.machines.listWithProfiles();
  if (!seeded) throw new Error('no seeded machine');
  const m = await scope.machines.createWithProfile(acmProfile(seeded.profile));
  return { id: m.machine.id, versionId: m.version.id, version: m.version.version, scope };
}

async function view(id: string, family?: string): Promise<VerificationOverview> {
  const res = await overview(
    new Request(`http://test${family ? `?family=${family}` : ''}`),
    ctx({ id }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as VerificationOverview;
}

async function verifyBoard(id: string, versionId: string) {
  const air = await record(
    json('POST', { step: 'airCut', profileVersionId: versionId, checks: CHECKS }),
    ctx({ id }),
  );
  expect(air.status).toBe(200);
  const t = (await view(id)).testPart;
  if (!t) throw new Error('no test part');
  const res = await record(
    json('POST', {
      step: 'testCut',
      profileVersionId: versionId,
      measurements: {
        edgeX: t.edge,
        edgeY: t.edge,
        diagonal: Math.round(t.diagonal * 100) / 100,
        holeDiameter: t.holeDiameter,
        pocketDepth: t.pocketDepth,
        thickness: t.thickness,
      },
    }),
    ctx({ id }),
  );
  expect(((await res.json()) as VerificationResponse).state).toBe('verified');
}

async function verifyComposite(id: string, versionId: string) {
  const air = await record(
    json('POST', {
      step: 'airCut',
      profileVersionId: versionId,
      checks: CHECKS,
      family: 'composite',
    }),
    ctx({ id }),
  );
  expect(air.status).toBe(200);
  const tray = (await view(id, 'composite')).tray;
  if (!tray) throw new Error('no tray');
  const res = await record(
    json('POST', {
      step: 'testCut',
      profileVersionId: versionId,
      family: 'composite',
      measurements: { remaining: 0.8, outerX: tray.foldedOuter, outerY: tray.foldedOuter },
    }),
    ctx({ id }),
  );
  expect(((await res.json()) as VerificationResponse).state).toBe('verified');
}

function bindTo(p: Project, machineId: string, version: number, profile: MachineProfile): Project {
  let out: Project = { ...p, machine: { machineId, profileVersion: version } };
  const r = applyCommand(out, 'runNesting', {
    toolDiameter: nestingToolDiameter(profile, out.stock) ?? 6,
  });
  if (!r.ok) throw new Error(r.error.message);
  out = r.project;
  return out;
}

function mdfProject(machineId: string, version: number, profile: MachineProfile): Project {
  const base = profile.materials.find((s) => s.material === 'mdf') ?? profile.materials[0];
  if (!base) throw new Error('no board set');
  let p = {
    schemaVersion: 2,
    machine: { machineId, profileVersion: version },
    stock: {
      material: base.material,
      thickness: base.thickness,
      sheet: { width: 2800, height: 2070, grain: 0 },
      useOffcuts: false,
    },
    parts: [],
    nesting: { mode: 'minWaste', gap: 8, margin: 10 },
    layout: { sheets: [] },
    cutting: { tabs: { auto: true }, leadIn: 'arc', direction: 'climb' },
    settings: { dimensionMode: 'cut' },
  } as Project;
  const r = applyCommand(p, 'addPart', {
    id: 'a',
    name: 'A',
    qty: 2,
    params: { w: 400, h: 600, r: 0 },
  });
  if (!r.ok) throw new Error(r.error.message);
  p = r.project;
  return bindTo(p, machineId, version, profile);
}

/** Saves the project and exports it; returns the status, the error and the NC texts. */
async function exportNc(p: Project, accept: boolean) {
  const res = await createProject(json('POST', { name: `B72 ${p.stock.material}`, project: p }));
  expect(res.status).toBe(201);
  const d = (await res.json()) as ProjectDetail;
  const ex = await doExport(
    json('POST', { revision: d.revision, acceptUnverified: accept, checklistConfirmed: true }),
    ctx({ id: d.id }),
  );
  const body = (await ex.json()) as ExportResponse & { error?: string };
  const texts: string[] = [];
  if (ex.status === 201 || ex.status === 200) {
    for (const f of body.files) {
      const dl = await fileOf(new Request('http://test'), ctx({ id: body.exportId, name: f.name }));
      expect(dl.status).toBe(200);
      texts.push(await dl.text());
    }
  }
  return { status: ex.status, error: body.error, texts, body };
}

describe('B72 tester: the job sees its family at the export API (T356)', () => {
  it('MDF-verified machine: MDF job verified without the material line; ACM job draft with it; gone after the ACM test cut', async () => {
    const m = await acmMachine();
    const profile = (await m.scope.machines.getWithProfile(m.id))?.profile;
    if (!profile) throw new Error('no profile');
    await verifyBoard(m.id, m.versionId);

    // The seeded post is unverified, so every export carries the draft header and needs the
    // acceptance; the family shows in the stored state and the material line.
    const mdf = await exportNc(mdfProject(m.id, m.version, profile), true);
    expect(mdf.status, `MDF export: ${mdf.error}`).toBe(201);
    expect(mdf.body.verification).toBe('verified');
    for (const t of mdf.texts) expect(t).not.toMatch(UNVERIFIED_LINE);

    const tray = bindTo(acmTrayPdfProject(), m.id, m.version, profile);
    const refused = await exportNc(tray, false);
    expect(refused.status).toBe(428);
    expect(refused.error).toBe('acceptance_required');
    const acm = await exportNc(tray, true);
    expect(acm.status, `ACM export: ${acm.error}`).toBe(201);
    expect(acm.body.verification).toBe('draft');
    expect(acm.texts.length).toBeGreaterThan(0);
    for (const t of acm.texts) {
      expect(t).toMatch(UNVERIFIED_LINE);
      expect(t).toMatch(DRAFT_HEADER);
    }

    await verifyComposite(m.id, m.versionId);
    const after = await exportNc(tray, true);
    expect(after.status, `ACM export after the test cut: ${after.error}`).toBe(201);
    expect(after.body.verification).toBe('verified');
    for (const t of after.texts) expect(t).not.toMatch(UNVERIFIED_LINE);
    // The wood family is untouched by the ACM record.
    expect((await view(m.id)).families).toEqual({ woodBoard: 'verified', composite: 'verified' });
  });

  it('ACM tray programs: test cut without accept=1 → 428; after the ACM test cut the air cut drops the material line', async () => {
    const m = await acmMachine();
    const air = await record(
      json('POST', {
        step: 'airCut',
        profileVersionId: m.versionId,
        checks: CHECKS,
        family: 'composite',
      }),
      ctx({ id: m.id }),
    );
    expect(air.status).toBe(200);
    const acm = await view(m.id, 'composite');
    const cutFile = acm.programs.testCut.files[0];
    if (!cutFile) throw new Error('no test cut file');
    const dl = (kind: string, name: string, accept: boolean) =>
      download(
        new Request(`http://test${accept ? '?accept=1' : ''}`),
        ctx({ id: m.id, kind, name }),
      );
    expect((await dl('acmTestCut', cutFile.name, false)).status).toBe(428);
    const ok = await dl('acmTestCut', cutFile.name, true);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toMatch(UNVERIFIED_LINE);
    // A wood kind name with the ACM file name does not hand out the ACM program without accept.
    expect([404, 409, 428]).toContain((await dl('testCut', cutFile.name, false)).status);

    await verifyComposite(m.id, m.versionId);
    const v = await view(m.id, 'composite');
    const airFile = v.programs.airCut.files[0];
    if (!airFile) throw new Error('no air cut file');
    // The seeded post is still unverified, so the acceptance stays; the material line goes.
    const free = await dl('acmAirCut', airFile.name, true);
    expect(free.status).toBe(200);
    expect(await free.text()).not.toMatch(UNVERIFIED_LINE);
  });

  it('another company: its machine is invisible to overview, record and downloads', async () => {
    await companyScope();
    const handle = await (globalThis as { nittcamDb?: Promise<DbHandle> }).nittcamDb;
    if (!handle) throw new Error('no db handle');
    const otherId = '00000000-0000-4000-8000-0000000000b7';
    await companies.ensure(handle.db, otherId, { name: 'Başka atölye B72' });
    const mine = await companyScope();
    const [seeded] = await mine.machines.listWithProfiles();
    if (!seeded) throw new Error('no seeded machine');
    const other = forCompany(handle.db, otherId);
    const m = await other.machines.createWithProfile(acmProfile(seeded.profile));
    const id = m.machine.id;
    const res = await overview(new Request('http://test?family=composite'), ctx({ id }));
    expect(res.status).toBe(404);
    const rec = await record(
      json('POST', {
        step: 'airCut',
        profileVersionId: m.version.id,
        checks: CHECKS,
        family: 'composite',
      }),
      ctx({ id }),
    );
    expect(rec.status).toBe(404);
    for (const kind of ['acmAirCut', 'acmTestCut', 'airCut']) {
      const d = await download(
        new Request('http://test?accept=1'),
        ctx({ id, kind, name: 'x.nc' }),
      );
      expect(d.status, kind).toBe(404);
    }
    // Nothing was written for the other company.
    expect((await other.machines.getWithProfile(id))?.families.composite).toBe('draft');
  });

  it('record API: ACM test cut before its air cut is refused; family aluminium refused; bad family 400', async () => {
    const m = await acmMachine();
    const early = await record(
      json('POST', {
        step: 'testCut',
        profileVersionId: m.versionId,
        family: 'composite',
        measurements: { remaining: 0.8, outerX: 200.97, outerY: 200.97 },
      }),
      ctx({ id: m.id }),
    );
    expect(early.status).toBeGreaterThanOrEqual(400);
    expect((await view(m.id, 'composite')).state).toBe('draft');
    for (const family of ['nonFerrous', 'wood', 'COMPOSITE']) {
      const r = await record(
        json('POST', { step: 'airCut', profileVersionId: m.versionId, checks: CHECKS, family }),
        ctx({ id: m.id }),
      );
      expect(r.status, `family ${family}`).toBe(400);
    }
    // Board measurements sent as the composite family are refused, not recorded as verified.
    await record(
      json('POST', {
        step: 'airCut',
        profileVersionId: m.versionId,
        checks: CHECKS,
        family: 'composite',
      }),
      ctx({ id: m.id }),
    );
    const wrong = await record(
      json('POST', {
        step: 'testCut',
        profileVersionId: m.versionId,
        family: 'composite',
        measurements: {
          edgeX: 200,
          edgeY: 200,
          diagonal: 282.84,
          holeDiameter: 8,
          pocketDepth: 5,
          thickness: 18,
        },
      }),
      ctx({ id: m.id }),
    );
    expect([400, 422]).toContain(wrong.status);
    expect((await view(m.id, 'composite')).state).toBe('air_cut_approved');
  });
});
