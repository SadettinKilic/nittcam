/**
 * B35 tester (T175, T178): tenancy of the new routes. Another company's project (live or deleted)
 * is never served as DXF, never listed under "Silinenler", never restored, and its name never
 * leaks through the 410 of a deleted link.
 */
import type { Project } from '@nittcam/core';
import { companies, forCompany, type DbHandle } from '@nittcam/db';
import { afterAll, describe, expect, it } from 'vitest';
import { companyScope } from '../../../lib/server/company';
import type { ProjectListItem } from '../../../lib/projects-api';
import { GET as list } from './route';
import { GET as getOne, PATCH as patch } from './[id]/route';
import { GET as dxf } from './[id]/dxf/route';

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const patchReq = (body: unknown) =>
  new Request('http://test', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

function project(): Project {
  return {
    schemaVersion: 2,
    machine: { machineId: 'draft', profileVersion: 1 },
    stock: {
      material: 'mdf',
      thickness: 18,
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

describe('B35 routes multi-tenancy', () => {
  it('foreign live and deleted projects stay invisible', async () => {
    await companyScope();
    const handle = await (globalThis as { nittcamDb?: Promise<DbHandle> }).nittcamDb;
    if (!handle) throw new Error('no db handle');
    const otherId = '00000000-0000-4000-8000-0000000000b5';
    await companies.ensure(handle.db, otherId, { name: 'Başka atölye' });
    const other = forCompany(handle.db, otherId);
    const live = await other.projects.create({ name: 'Yabancı', data: project(), commands: [] });
    const gone = await other.projects.create({ name: 'Gizli sır', data: project(), commands: [] });
    await other.projects.setDeleted(gone.id, true);

    for (const p of [live, gone]) {
      for (const tur of ['dizilim', 'parcalar']) {
        const r = await dxf(new Request(`http://test/x?revision=1&tur=${tur}`), ctx(p.id));
        expect(r.status, `${p.name} ${tur}`).toBe(404);
      }
    }
    const direct = await getOne(new Request('http://test'), ctx(gone.id));
    expect(direct.status).toBe(404);
    expect(await direct.text()).not.toContain('Gizli');

    const deleted = (await (
      await list(new Request('http://test/api/projects?silinen=1'))
    ).json()) as ProjectListItem[];
    expect(deleted.some((i) => i.id === gone.id || i.id === live.id)).toBe(false);

    expect((await patch(patchReq({ deleted: false }), ctx(gone.id))).status).toBe(404);
    expect((await patch(patchReq({ deleted: true }), ctx(live.id))).status).toBe(404);
    expect((await other.projects.get(gone.id))?.deletedAt).not.toBeNull();
    expect((await other.projects.get(live.id))?.deletedAt).toBeNull();
  });

  it('DXF bad queries → 400', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    for (const q of [
      'revision=0',
      'revision=abc',
      'revision=1&tur=x',
      'revision=-1',
      'revision=1.0',
    ]) {
      expect((await dxf(new Request(`http://test/x?${q}`), ctx(id))).status, q).toBe(400);
    }
  });
});
