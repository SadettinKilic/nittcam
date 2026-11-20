/** T145: the DXF layer mapping is a company setting (in-memory PGlite database). */
import type { DbHandle } from '@nittcam/db';
import { afterAll, describe, expect, it } from 'vitest';
import { GET, PUT } from './route';

const put = (body: unknown) =>
  PUT(
    new Request('http://test', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

afterAll(async () => {
  const cache = globalThis as { nittcamDb?: Promise<DbHandle> };
  await (await cache.nittcamDb)?.close();
});

describe('/api/settings/dxf-layers (T145)', () => {
  it('starts empty, merges choices (case-insensitive) and persists them', async () => {
    expect(await (await GET()).json()).toEqual({ map: {} });
    const first = await put({ layers: { Kesim: 'outside', Delik: 'drill', Yazi: 'auto' } });
    expect(await first.json()).toEqual({ map: { KESIM: 'outside', DELIK: 'drill' } });
    await put({ layers: { delik: 'ignore' } });
    expect(await (await GET()).json()).toEqual({ map: { KESIM: 'outside', DELIK: 'ignore' } });
  });

  it('rejects unknown operations and malformed bodies', async () => {
    expect((await put({ layers: { A: 'laser' } })).status).toBe(400);
    // T182: `{ map }` alone is the editor's replace; mixed or unknown keys stay malformed.
    expect((await put({ map: {}, layers: {} })).status).toBe(400);
    expect((await put({ maps: {} })).status).toBe(400);
  });
});
