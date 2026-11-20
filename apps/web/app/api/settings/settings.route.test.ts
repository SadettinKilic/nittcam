/**
 * T182: GET/PATCH /api/settings (name, defaults), the logo upload limits and the DXF layer map
 * replace (`PUT { map }`). The default company of the test DB; values are restored at the end.
 */
import type { DbHandle } from '@nittcam/db';
import { BUILT_IN_PROJECT_DEFAULTS } from '@nittcam/core';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CompanySettings } from '../../../lib/settings-api';
import { PUT as putLayers } from './dxf-layers/route';
import { DELETE as deleteLogo, GET as getLogo, POST as postLogo } from './logo/route';
import { GET, PATCH } from './route';

const patch = (body: unknown) =>
  PATCH(
    new Request('http://test/x', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
const upload = (bytes: Uint8Array<ArrayBuffer>, name = 'logo.png') => {
  const form = new FormData();
  form.append('file', new File([bytes], name));
  return postLogo(new Request('http://test/x', { method: 'POST', body: form }));
};
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

let before: CompanySettings;
beforeAll(async () => {
  process.env.STORAGE_DIR = mkdtempSync(join(tmpdir(), 'nittcam-logo-'));
  before = (await (await GET()).json()) as CompanySettings;
});
afterAll(async () => {
  await patch({ name: before.name, defaults: before.defaults });
  await deleteLogo();
  const cache = globalThis as { nittcamDb?: Promise<DbHandle> };
  await (await cache.nittcamDb)?.close();
});

describe('/api/settings (T182)', () => {
  it('reads and saves the name and defaults; bad bodies 400', async () => {
    expect(before.defaults).toEqual(expect.objectContaining({ gap: expect.any(Number) }));
    const d = { ...BUILT_IN_PROJECT_DEFAULTS, gap: 4, tabMode: 'small', leadIn: 'line' };
    const res = await patch({ name: '  Usta Atölye ', defaults: d });
    expect(res.status).toBe(200);
    const body = (await res.json()) as CompanySettings;
    expect(body.name).toBe('Usta Atölye');
    expect(body.defaults).toEqual(d);
    expect((await patch({ name: ' ' })).status).toBe(400);
    expect((await patch({ defaults: { ...d, gap: 500 } })).status).toBe(400);
    expect((await patch({ defaults: { gap: 3 } })).status).toBe(400);
    expect((await patch({ other: 1 })).status).toBe(400);
    expect((await patch({})).status).toBe(400);
  });

  it('logo: PNG stored and served; svg, empty and oversize refused; delete', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const refused = await upload(svg, 'logo.png');
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: 'type' });
    expect(((await (await upload(new Uint8Array())).json()) as { error: string }).error).toBe(
      'empty',
    );
    const big = new Uint8Array(512 * 1024 + 1);
    big.set(PNG);
    expect((await upload(big)).status).toBe(400);

    const ok = await upload(PNG, 'x.svg');
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { logoUrl: string }).logoUrl).toMatch(
      /^\/api\/settings\/logo\?v=/,
    );
    const served = await getLogo();
    expect(served.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(PNG);
    expect(((await (await GET()).json()) as CompanySettings).logoUrl).not.toBeNull();

    expect((await deleteLogo()).status).toBe(200);
    expect((await getLogo()).status).toBe(404);
  });

  it('DXF layers: PUT { map } replaces, normalises keys and drops auto', async () => {
    const put = (body: unknown) =>
      putLayers(
        new Request('http://test/x', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
      );
    await put({ layers: { ESKI: 'drill' } });
    const res = await put({ map: { ' kesim ': 'outside', OTO: 'auto' } });
    expect(await res.json()).toEqual({ map: { KESIM: 'outside' } });
    expect((await put({ map: { X: 'zig' } })).status).toBe(400);
    expect((await put({ map: {}, layers: {} })).status).toBe(400);
    await put({ map: {} });
  });
});
