/** T121: the material library API against an in-memory PGlite database. */
import type { DbHandle } from '@nittcam/db';
import { afterAll, describe, expect, it } from 'vitest';
import type { MaterialApiError, MaterialItem } from '../../../lib/materials-api';
import { DELETE, PUT } from './[id]/route';
import { GET, POST } from './route';

const json = (method: string, body: unknown) =>
  new Request('http://test', {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

const entry = {
  kind: 'melamine',
  name: 'Antrasit melamin',
  thicknesses: [18, 8],
  tone: 'anthracite',
  grain: 0,
  sheetSizes: [{ width: 2800, height: 2100 }],
};

afterAll(async () => {
  const cache = globalThis as { nittcamDb?: Promise<DbHandle> };
  await (await cache.nittcamDb)?.close();
});

describe('/api/materials (T121)', () => {
  it('lists the seeded library sorted by Turkish name', async () => {
    const items = (await (await GET()).json()) as MaterialItem[];
    expect(items.map((m) => m.name)).toEqual(['Akrilik', 'Kontrplak', 'MDF', 'Melamin']);
  });

  it('creates, updates and deletes an entry', async () => {
    const res = await POST(json('POST', { material: entry }));
    expect(res.status).toBe(201);
    const created = (await res.json()) as MaterialItem;
    expect(created.thicknesses).toEqual([8, 18]);
    const put = await PUT(
      json('PUT', { material: { ...entry, name: 'Antrasit' } }),
      ctx(created.id),
    );
    expect(((await put.json()) as MaterialItem).name).toBe('Antrasit');
    expect((await DELETE(new Request('http://test'), ctx(created.id))).status).toBe(204);
    expect((await DELETE(new Request('http://test'), ctx(created.id))).status).toBe(404);
  });

  it('rejects invalid bodies with Turkish-mappable issues', async () => {
    const res = await POST(json('POST', { material: { ...entry, sheetSizes: [] } }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as MaterialApiError;
    expect(body).toMatchObject({ error: 'invalid_material' });
    expect((await POST(json('POST', { nope: 1 }))).status).toBe(400);
    expect((await PUT(json('PUT', { material: entry }), ctx('not-a-uuid'))).status).toBe(404);
    expect(
      (await PUT(json('PUT', { material: entry }), ctx('00000000-0000-4000-8000-00000000abcd')))
        .status,
    ).toBe(404);
  });
});
