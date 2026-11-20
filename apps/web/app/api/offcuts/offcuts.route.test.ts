/** T168: the offcut stock API (in-memory PGlite): create, filter, status, multi-tenancy. */
import type { Project } from '@nittcam/core';
import { companies, forCompany, type DbHandle } from '@nittcam/db';
import { afterAll, describe, expect, it } from 'vitest';
import { companyScope } from '../../../lib/server/company';
import { markOffcutsUsed } from '../../../lib/server/offcuts';
import type { OffcutItem } from '../../../lib/offcuts-api';
import { PATCH } from './[id]/route';
import { GET, POST } from './route';

const json = (method: string, body: unknown) =>
  new Request('http://test', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const list = async (query = ''): Promise<OffcutItem[]> =>
  (await (await GET(new Request(`http://test/api/offcuts${query}`))).json()) as OffcutItem[];

const offcut = { material: 'mdf', thickness: 18, width: 900, height: 600, grain: 0 };

afterAll(async () => {
  const cache = globalThis as { nittcamDb?: Promise<DbHandle> };
  await (await cache.nittcamDb)?.close();
});

describe('/api/offcuts (T168)', () => {
  it('saves confirmed leftovers and filters by material, thickness and status', async () => {
    const res = await POST(
      json('POST', { offcuts: [offcut, { ...offcut, thickness: 8, grain: null }] }),
    );
    expect(res.status).toBe(201);
    const created = (await res.json()) as OffcutItem[];
    expect(created.map((o) => o.status)).toEqual(['available', 'available']);
    const mdf18 = await list('?material=mdf&thickness=18&status=available');
    expect(mdf18.map((o) => o.id)).toEqual([created[0]?.id]);
  });

  it('rejects invalid bodies', async () => {
    for (const body of [
      {},
      { offcuts: [] },
      { offcuts: [{ ...offcut, width: -1 }] },
      { offcuts: [{ ...offcut, grain: 45 }] },
      { offcuts: [{ ...offcut, extra: 1 }] },
    ]) {
      expect((await POST(json('POST', body))).status).toBe(400);
    }
  });

  it('changes the status; an export marks the layout offcuts used', async () => {
    const [o] = (await (await POST(json('POST', { offcuts: [offcut] }))).json()) as OffcutItem[];
    if (!o) throw new Error('not created');
    const patched = await PATCH(json('PATCH', { status: 'reserved' }), ctx(o.id));
    expect(((await patched.json()) as OffcutItem).status).toBe('reserved');
    expect((await PATCH(json('PATCH', { status: 'gone' }), ctx(o.id))).status).toBe(400);

    const project = {
      layout: { sheets: [{ offcutId: o.id, size: { width: 900, height: 600 }, placements: [{}] }] },
    } as unknown as Project;
    await markOffcutsUsed(await companyScope(), project);
    expect((await list()).find((x) => x.id === o.id)?.status).toBe('used');
  });

  it('another company offcut is invisible and cannot be changed or consumed', async () => {
    await companyScope();
    const handle = await (globalThis as { nittcamDb?: Promise<DbHandle> }).nittcamDb;
    if (!handle) throw new Error('no db handle');
    const otherId = '00000000-0000-4000-8000-0000000000ab';
    await companies.ensure(handle.db, otherId, { name: 'Başka atölye' });
    const other = forCompany(handle.db, otherId);
    const foreign = await other.offcuts.create({ ...offcut, sourceProjectId: null });

    expect((await list()).some((o) => o.id === foreign.id)).toBe(false);
    expect((await PATCH(json('PATCH', { status: 'used' }), ctx(foreign.id))).status).toBe(404);
    const project = {
      layout: { sheets: [{ offcutId: foreign.id, placements: [{}] }] },
    } as unknown as Project;
    await markOffcutsUsed(await companyScope(), project);
    expect((await other.offcuts.get(foreign.id))?.status).toBe('available');
  });

  it('a foreign source project is dropped, never linked', async () => {
    const handle = await (globalThis as { nittcamDb?: Promise<DbHandle> }).nittcamDb;
    if (!handle) throw new Error('no db handle');
    const other = forCompany(handle.db, '00000000-0000-4000-8000-0000000000ab');
    const p = await other.projects.create({
      name: 'Yabancı',
      data: {
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
      } as Project,
      commands: [],
    });
    const res = await POST(json('POST', { offcuts: [{ ...offcut, sourceProjectId: p.id }] }));
    expect(res.status).toBe(201);
    expect(((await res.json()) as OffcutItem[])[0]?.sourceProjectId).toBeNull();
  });
});
