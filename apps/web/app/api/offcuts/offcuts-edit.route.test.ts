/** T291: manual add (no source project), edit, soft delete and restore; tenant-scoped. */
import { companies, forCompany, type DbHandle } from '@nittcam/db';
import { afterAll, describe, expect, it } from 'vitest';
import { readOffcutPatch } from '../../../lib/server/offcuts';
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
const patch = (id: string, body: unknown) => PATCH(json('PATCH', body), ctx(id));

afterAll(async () => {
  const cache = globalThis as { nittcamDb?: Promise<DbHandle> };
  await (await cache.nittcamDb)?.close();
});

describe('readOffcutPatch (T291)', () => {
  it('reads delete, edit and status bodies; rejects mixes and bad values', () => {
    expect(readOffcutPatch({ deleted: true })).toEqual({ kind: 'deleted', deleted: true });
    expect(readOffcutPatch({ width: 500, grain: null, material: ' mdf ' })).toEqual({
      kind: 'edit',
      edit: { width: 500, grain: null, material: 'mdf' },
    });
    expect(readOffcutPatch({ status: 'used' })).toEqual({ kind: 'edit', edit: { status: 'used' } });
    for (const bad of [
      {},
      null,
      [],
      { deleted: 'yes' },
      { deleted: true, width: 5 },
      { width: 0 },
      { width: 10_001 },
      { thickness: Number.NaN },
      { grain: 45 },
      { material: '' },
      { status: 'gone' },
      { sourceProjectId: null },
      { id: 'x' },
    ]) {
      expect(readOffcutPatch(bad)).toBeNull();
    }
  });
});

describe('/api/offcuts manual stock (T291)', () => {
  it('adds without a source, edits sizes and grain, deletes and restores with the same id', async () => {
    const res = await POST(
      json('POST', {
        offcuts: [{ material: 'plywood', thickness: 12, width: 700, height: 400, grain: null }],
      }),
    );
    expect(res.status).toBe(201);
    const [o] = (await res.json()) as OffcutItem[];
    if (!o) throw new Error('not created');
    expect(o.sourceProjectId).toBeNull();
    expect(o.status).toBe('available');

    const edited = await patch(o.id, { width: 650, height: 380, grain: 90, thickness: 15 });
    expect(edited.status).toBe(200);
    const e = (await edited.json()) as OffcutItem;
    expect([e.width, e.height, e.grain, e.thickness, e.material]).toEqual([
      650,
      380,
      90,
      15,
      'plywood',
    ]);
    expect(e.createdAt).toBe(o.createdAt);

    expect((await patch(o.id, { deleted: true })).status).toBe(200);
    expect((await list()).some((x) => x.id === o.id)).toBe(false);
    const back = (await (await patch(o.id, { deleted: false })).json()) as OffcutItem & {
      deleted: boolean;
    };
    expect(back.deleted).toBe(false);
    expect((await list('?material=plywood&thickness=15')).find((x) => x.id === o.id)?.width).toBe(
      650,
    );

    expect((await patch(o.id, { width: -1 })).status).toBe(400);
    expect((await patch('00000000-0000-4000-8000-00000000ffff', { deleted: true })).status).toBe(
      404,
    );
  });

  it('another company offcut cannot be edited, deleted or restored', async () => {
    const handle = await (globalThis as { nittcamDb?: Promise<DbHandle> }).nittcamDb;
    if (!handle) throw new Error('no db handle');
    const otherId = '00000000-0000-4000-8000-0000000000ac';
    await companies.ensure(handle.db, otherId, { name: 'Başka atölye 2' });
    const other = forCompany(handle.db, otherId);
    const foreign = await other.offcuts.create({
      material: 'mdf',
      thickness: 18,
      width: 900,
      height: 600,
      grain: 0,
      sourceProjectId: null,
    });
    expect((await patch(foreign.id, { width: 100 })).status).toBe(404);
    expect((await patch(foreign.id, { deleted: true })).status).toBe(404);
    const row = await other.offcuts.get(foreign.id);
    expect([row?.width, row?.deletedAt]).toEqual([900, null]);
    await other.offcuts.setDeleted(foreign.id, true);
    expect((await patch(foreign.id, { deleted: false })).status).toBe(404);
    expect((await other.offcuts.list()).some((x) => x.id === foreign.id)).toBe(false);
  });
});
