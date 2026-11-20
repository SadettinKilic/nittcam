/**
 * T179: project status flow (taslak → üretildi after a stored NC export → tamamlandı by hand) and
 * re-export from history from the export's own revision snapshot (D-066): same state = same bytes
 * and record; a changed machine verification state = a new record marked `stateChanged` (E6).
 */
import { createHash, randomUUID } from 'node:crypto';
import { applyCommand, nestingToolDiameter, type Project } from '@nittcam/core';
import type { DbHandle } from '@nittcam/db';
import { afterAll, describe, expect, it } from 'vitest';
import type { ExportRecord, ExportResponse } from '../../../lib/exports-api';
import type { ProjectDetail } from '../../../lib/projects-api';
import { companyScope } from '../../../lib/server/company';
import { POST as create } from '../projects/route';
import { PATCH as patch, PUT as put } from '../projects/[id]/route';
import { POST as doExport } from '../projects/[id]/export/route';
import { POST as documents } from '../projects/[id]/documents/route';
import { GET as history } from '../projects/[id]/exports/route';
import { GET as download } from './[id]/files/[name]/route';
import { POST as reexport } from './[id]/reexport/route';

const json = (method: string, body: unknown) =>
  new Request('http://test', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

async function project(): Promise<{ p: Project; machineId: string; versionId: string }> {
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
  return { p, machineId: m.machine.id, versionId: m.version.id };
}

async function fileHash(rec: ExportRecord): Promise<string> {
  const f = rec.files[0];
  if (!f) throw new Error('no file');
  const res = await download(new Request('http://test'), ctx({ id: rec.exportId, name: f.name }));
  return sha(new Uint8Array(await res.arrayBuffer()));
}

async function historyOf(id: string): Promise<ExportRecord[]> {
  return (await (await history(new Request('http://test'), ctx({ id }))).json()) as ExportRecord[];
}

afterAll(async () => {
  const cache = globalThis as { nittcamDb?: Promise<DbHandle> };
  await (await cache.nittcamDb)?.close();
});

describe('status flow and re-export (T179)', () => {
  it('moves taslak → üretildi → tamamlandı and re-exports old revisions byte for byte', async () => {
    const { p, machineId, versionId } = await project();
    const created = await create(json('POST', { name: 'Raflar', project: p }));
    const d = (await created.json()) as ProjectDetail;
    const id = d.id;
    const scope = await companyScope();
    expect((await scope.projects.get(id))?.status).toBe('draft');

    // Manual status needs an NC export first; "taslak" is never set by hand.
    expect((await patch(json('PATCH', { status: 'completed' }), ctx({ id }))).status).toBe(409);
    expect((await patch(json('PATCH', { status: 'draft' }), ctx({ id }))).status).toBe(400);

    // A document does not change the status; a stored NC export does.
    await documents(json('POST', { revision: d.revision, type: 'pdf-a4' }), ctx({ id }));
    expect((await scope.projects.get(id))?.status).toBe('draft');
    const ncRes = await doExport(
      json('POST', { revision: d.revision, acceptUnverified: true }),
      ctx({ id }),
    );
    expect(ncRes.status).toBe(201);
    const nc = (await ncRes.json()) as ExportResponse;
    expect(nc.stateChanged).toBe(false);
    expect((await scope.projects.get(id))?.status).toBe('produced');
    const ncHash = await fileHash(nc);

    // Manual: üretildi → tamamlandı → üretildi; the revision stays.
    const done = await patch(json('PATCH', { status: 'completed' }), ctx({ id }));
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ id, status: 'completed' });
    expect((await scope.projects.get(id))?.revision).toBe(d.revision);
    // A later NC export keeps "tamamlandı".
    await doExport(json('POST', { revision: d.revision, acceptUnverified: true }), ctx({ id }));
    expect((await scope.projects.get(id))?.status).toBe('completed');
    expect((await patch(json('PATCH', { status: 'produced' }), ctx({ id }))).status).toBe(200);

    // Save a new revision: the old export is re-exported from its own snapshot.
    const moved = { ...p, nesting: { ...p.nesting, gap: 12 } };
    const saved = await put(json('PUT', { baseRevision: d.revision, project: moved }), ctx({ id }));
    expect(saved.status).toBe(200);
    expect((await scope.projects.get(id))?.revision).toBe(d.revision + 1);

    // Unverified files need the acceptance again.
    expect((await reexport(json('POST', {}), ctx({ id: nc.exportId }))).status).toBe(428);
    const again = await reexport(
      json('POST', { acceptUnverified: true }),
      ctx({ id: nc.exportId }),
    );
    expect(again.status).toBe(200);
    const same = (await again.json()) as ExportResponse;
    expect(same.exportId).toBe(nc.exportId);
    expect(same.revision).toBe(d.revision);
    expect(same.hash).toBe(nc.hash);
    expect(same.stateChanged).toBe(false);
    expect(await fileHash(same)).toBe(ncHash);

    // Documents too: the same record from the snapshot.
    const pdfRow = (await historyOf(id)).find((r) => r.post.id === 'pdf-a4');
    if (!pdfRow) throw new Error('no pdf row');
    const pdfAgain = await reexport(json('POST', {}), ctx({ id: pdfRow.exportId }));
    expect(pdfAgain.status).toBe(200);
    expect(((await pdfAgain.json()) as ExportResponse).hash).toBe(pdfRow.hash);

    // E6: the machine's verification state changes → a new record, the old one stays.
    await scope.machines.recordVerification(machineId, {
      profileVersionId: versionId,
      stage: 'air_cut_approved',
    });
    const changed = await reexport(
      json('POST', { acceptUnverified: true }),
      ctx({ id: nc.exportId }),
    );
    expect(changed.status).toBe(201);
    const rec = (await changed.json()) as ExportResponse;
    expect(rec.exportId).not.toBe(nc.exportId);
    expect(rec.revision).toBe(d.revision);
    expect(rec.verification).toBe('air_cut_approved');
    expect(rec.stateChanged).toBe(true);
    expect(rec.hash).not.toBe(nc.hash);
    // Same state again → the same new record.
    const repeat = await reexport(
      json('POST', { acceptUnverified: true }),
      ctx({ id: nc.exportId }),
    );
    expect(((await repeat.json()) as ExportResponse).exportId).toBe(rec.exportId);

    const rows = await historyOf(id);
    const old = rows.find((r) => r.exportId === nc.exportId);
    expect(old?.hash).toBe(nc.hash);
    expect(old?.verification).toBe('draft');
    expect(old?.stateChanged).toBe(false);
    expect(rows.find((r) => r.exportId === rec.exportId)?.stateChanged).toBe(true);
    expect(await fileHash(nc)).toBe(ncHash);
  });

  it('refuses unknown exports and bad input', async () => {
    const bad = await reexport(json('POST', { acceptUnverified: 'yes' }), ctx({ id: randomUUID() }));
    expect(bad.status).toBe(400);
    expect((await reexport(json('POST', {}), ctx({ id: randomUUID() }))).status).toBe(404);
    expect((await reexport(json('POST', {}), ctx({ id: 'nope' }))).status).toBe(404);
  });
});
