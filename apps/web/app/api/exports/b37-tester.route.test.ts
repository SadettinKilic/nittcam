/**
 * Tester (B37): tenancy and gates of the new routes. Another company's export cannot be re-exported
 * or zipped (404); another company's project has no report, no documents, no status change (404);
 * an unverified export without acceptance cannot be stored (db check); documents never make NC.
 */
import { randomUUID } from 'node:crypto';
import { companies, forCompany, type DbHandle } from '@nittcam/db';
import { afterAll, describe, expect, it } from 'vitest';
import { newProject } from '../../../lib/draft-project';
import { companyScope } from '../../../lib/server/company';
import { PATCH as patchProject } from '../projects/[id]/route';
import { POST as documents } from '../projects/[id]/documents/route';
import { GET as report } from '../projects/[id]/report/route';
import { GET as history } from '../projects/[id]/exports/route';
import { POST as reexport } from './[id]/reexport/route';
import { GET as zip } from './[id]/zip/route';

const OTHER = '00000000-0000-4000-8000-0000000000b7';
const json = (method: string, body: unknown) =>
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

async function handle(): Promise<DbHandle> {
  await companyScope();
  const h = await (globalThis as { nittcamDb?: Promise<DbHandle> }).nittcamDb;
  if (!h) throw new Error('no db handle');
  return h;
}

async function exportRow(scope: ReturnType<typeof forCompany>, accepted: boolean) {
  const own = await companyScope();
  const [seeded] = await own.machines.listWithProfiles();
  if (!seeded) throw new Error('no seeded machine');
  const p = structuredClone(seeded.profile);
  p.example = false;
  p.identity.name = `B37 ${randomUUID().slice(0, 6)}`;
  const m = await scope.machines.createWithProfile(p);
  const project = await scope.projects.create({ name: 'Yabancı', data: newProject() });
  const id = randomUUID();
  const res = await scope.exports.createOnce({
    id,
    projectId: project.id,
    projectRevision: project.revision,
    machineProfileVersionId: m.version.id,
    postId: 'mach3',
    postVersion: '1',
    kind: 'nc',
    sha256: randomUUID().replace(/-/g, ''),
    fileKey: `exports/${id}`,
    files: [],
    validationStage: 'draft',
    unverified: true,
    acceptedUnverifiedAt: accepted ? new Date() : null,
  });
  return { exportId: res.row.id, projectId: project.id };
}

describe('B37 tester: tenancy and gates', () => {
  it('another company export: re-export and zip are 404', async () => {
    const h = await handle();
    await companies.ensure(h.db, OTHER, { name: 'Başka atölye B37' });
    const other = forCompany(h.db, OTHER);
    const { exportId, projectId } = await exportRow(other, true);
    const re = await reexport(json('POST', { acceptUnverified: true }), ctx({ id: exportId }));
    expect(re.status).toBe(404);
    expect((await zip(new Request('http://test'), ctx({ id: exportId }))).status).toBe(404);
    // Its project: no report, no documents, no history, no status change.
    expect(
      (await report(new Request('http://test?revision=1'), ctx({ id: projectId }))).status,
    ).toBe(404);
    const doc = await documents(
      json('POST', { revision: 1, type: 'pdf-a4' }),
      ctx({ id: projectId }),
    );
    expect(doc.status).toBe(404);
    const hist = await history(new Request('http://test'), ctx({ id: projectId }));
    expect([200, 404]).toContain(hist.status);
    if (hist.status === 200) expect(await hist.json()).toEqual([]);
    const st = await patchProject(json('PATCH', { status: 'completed' }), ctx({ id: projectId }));
    expect(st.status).toBe(404);
    expect((await other.projects.get(projectId))?.status).toBe('draft');
  });

  it('an unverified export without acceptance cannot even be stored (so never zipped)', async () => {
    const h = await handle();
    const own = forCompany(h.db, (await companyScope()).companyId);
    await expect(exportRow(own, false)).rejects.toThrow();
  });

  it('documents never make NC; status needs a known value', async () => {
    const scope = await companyScope();
    const p = await scope.projects.create({ name: 'B37 doc', data: newProject() });
    for (const type of ['nc', 'gcode', 'etiket-x', '']) {
      const res = await documents(json('POST', { revision: p.revision, type }), ctx({ id: p.id }));
      expect(res.status, type).toBe(400);
    }
    for (const body of [
      { status: 'draft' },
      { status: 'done' },
      { deleted: true, status: 'completed' },
      {},
    ]) {
      expect((await patchProject(json('PATCH', body), ctx({ id: p.id }))).status).toBe(400);
    }
    // Deleted project: status change is 404.
    await scope.projects.setDeleted(p.id, true);
    expect(
      (await patchProject(json('PATCH', { status: 'completed' }), ctx({ id: p.id }))).status,
    ).toBe(404);
  });
});
