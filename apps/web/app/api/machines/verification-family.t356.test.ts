/**
 * T356 (§7.3, D-118, D-138): verification per material family against an in-memory PGlite
 * database. Records without a family are the wood board family (existing machines keep their
 * state); the ACM (composite) family has its own state, history and the V-groove tray part.
 */
import { randomUUID } from 'node:crypto';
import type { MachineProfile } from '@nittcam/core';
import type { DbHandle } from '@nittcam/db';
import { afterAll, describe, expect, it } from 'vitest';
import { companyScope } from '../../../lib/server/company';
import { machineForJob } from '../../../lib/server/exports';
import type { VerificationOverview, VerificationResponse } from '../../../lib/verification-api';
import { GET as download } from './[id]/verification/[kind]/[name]/route';
import { GET as overview, POST as record } from './[id]/verification/route';

const CHECKS = { axes: true, spindle: true, safeZ: true, noContact: true };
const post = (body: unknown) =>
  new Request('http://test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

/** The seeded machine plus an ACM 4 mm set (flat end mill) and a 90° V-bit T7. */
async function acmMachine(edit: (p: MachineProfile) => void = () => undefined) {
  const scope = await companyScope();
  const [seeded] = await scope.machines.listWithProfiles();
  if (!seeded) throw new Error('no seeded machine');
  const p = structuredClone(seeded.profile);
  p.example = false;
  p.identity.name = `ACM ${randomUUID().slice(0, 6)}`;
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
  edit(p);
  const m = await scope.machines.createWithProfile(p);
  return { id: m.machine.id, versionId: m.version.id, scope };
}

async function view(id: string, family?: string): Promise<VerificationOverview> {
  const res = await overview(
    new Request(`http://test${family ? `?family=${family}` : ''}`),
    ctx(id),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as VerificationOverview;
}

async function verifyBoard(id: string, versionId: string) {
  expect(
    (await record(post({ step: 'airCut', profileVersionId: versionId, checks: CHECKS }), ctx(id)))
      .status,
  ).toBe(200);
  const t = (await view(id)).testPart;
  if (!t) throw new Error('no test part');
  const res = await record(
    post({
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
    ctx(id),
  );
  expect(((await res.json()) as VerificationResponse).state).toBe('verified');
}

afterAll(async () => {
  const cache = globalThis as { nittcamDb?: Promise<DbHandle> };
  await (await cache.nittcamDb)?.close();
});

describe('verification per material family (T356)', () => {
  it('a machine verified with MDF is not verified for ACM; each family has its own history', async () => {
    const m = await acmMachine();
    await verifyBoard(m.id, m.versionId);
    const board = await view(m.id);
    expect(board.state).toBe('verified');
    expect(board.families).toEqual({ woodBoard: 'verified', composite: 'draft' });
    const acm = await view(m.id, 'composite');
    expect(acm.family).toBe('composite');
    expect(acm.state).toBe('draft');
    expect(acm.history).toEqual([]);
    expect(acm.testPart).toBeNull();
    expect(acm.tray).toMatchObject({ material: 'acm', vBit: 7, vAngle: 90, remaining: 0.8 });
    // the composite family is unverified: its programs need the acceptance
    expect(acm.unverifiedReasons.length).toBeGreaterThan(0);
    expect(acm.programs.airCut.ok).toBe(true);
    expect(acm.programs.testCut.allowed).toBe(false);
    // the job sees its family's state (wood unchanged)
    const found = await m.scope.machines.getWithProfile(m.id);
    expect(machineForJob(found, { stock: { material: 'mdf' } } as never)?.state).toBe('verified');
    expect(machineForJob(found, { stock: { material: 'acrylic' } } as never)?.state).toBe(
      'verified',
    );
    expect(machineForJob(found, { stock: { material: 'acm' } } as never)?.state).toBe('draft');
  });

  it('ACM air cut, then the tray measured in tolerance → composite verified; wood untouched', async () => {
    const m = await acmMachine();
    const air = await record(
      post({ step: 'airCut', profileVersionId: m.versionId, checks: CHECKS, family: 'composite' }),
      ctx(m.id),
    );
    expect(air.status).toBe(200);
    const acm = await view(m.id, 'composite');
    expect(acm.state).toBe('air_cut_approved');
    expect(acm.programs.testCut.allowed).toBe(true);
    expect((await view(m.id)).state).toBe('draft');
    const tray = acm.tray;
    if (!tray) throw new Error('no tray');
    const bad = await record(
      post({
        step: 'testCut',
        profileVersionId: m.versionId,
        family: 'composite',
        measurements: { remaining: 0.6, outerX: tray.foldedOuter, outerY: tray.foldedOuter },
      }),
      ctx(m.id),
    );
    expect(((await bad.json()) as VerificationResponse).state).toBe('test_cut_approved');
    const good = await record(
      post({
        step: 'testCut',
        profileVersionId: m.versionId,
        family: 'composite',
        measurements: { remaining: 0.82, outerX: tray.foldedOuter + 0.3, outerY: tray.foldedOuter },
      }),
      ctx(m.id),
    );
    const body = (await good.json()) as VerificationResponse;
    expect(body.state).toBe('verified');
    expect(body.evaluation?.items.map((i) => i.key)).toEqual(['remaining', 'outerX', 'outerY']);
    const after = await view(m.id, 'composite');
    expect(after.families).toEqual({ woodBoard: 'draft', composite: 'verified' });
    expect(after.history.map((h) => h.stage)).toEqual([
      'verified',
      'test_cut_approved',
      'air_cut_approved',
    ]);
    expect((await view(m.id)).history).toEqual([]);
  });

  it('ACM programs download through their own kind; the unverified file needs accept=1', async () => {
    const m = await acmMachine();
    const acm = await view(m.id, 'composite');
    const file = acm.programs.airCut.files[0];
    if (!file) throw new Error('no air-cut file');
    expect(file.downloadUrl).toContain('/acmAirCut/');
    const dl = (accept: boolean) =>
      download(new Request(`http://test${accept ? '?accept=1' : ''}`), {
        params: Promise.resolve({ id: m.id, kind: 'acmAirCut', name: file.name }),
      });
    expect((await dl(false)).status).toBe(428);
    const ok = await dl(true);
    expect(ok.status).toBe(200);
    const text = await ok.text();
    expect(text).toContain('DOGRULANMAMIS MALZEME: ACM');
    // the test cut is locked until the ACM air cut is approved
    const cut = await download(new Request('http://test?accept=1'), {
      params: Promise.resolve({ id: m.id, kind: 'acmTestCut', name: 'x.nc' }),
    });
    expect(cut.status).toBe(409);
  });

  it('a machine without a V-bit offers no tray; bad family → 400', async () => {
    const m = await acmMachine((p) => {
      p.tools = p.tools.filter((t) => t.type !== 'vBit');
    });
    expect((await view(m.id, 'composite')).tray).toBeNull();
    const res = await overview(new Request('http://test?family=nonFerrous'), ctx(m.id));
    expect(res.status).toBe(400);
  });
});
