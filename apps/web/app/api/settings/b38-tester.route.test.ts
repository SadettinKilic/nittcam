/**
 * Tester (B38, T182): logo tenancy and upload edges. Another company's logo is never served,
 * replaced or deleted through this company's routes, not even with a tampered stored key; the type
 * comes from the bytes (a JPEG named .png is served as JPEG, SVG/GIF/HTML named .png refused);
 * exactly 512 KB is accepted, one byte more is not.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { companies, forCompany, type DbHandle } from '@nittcam/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LOGO_MAX_BYTES } from '../../../lib/logo';
import { companyScope, companyStorage } from '../../../lib/server/company';
import { DELETE as deleteLogo, GET as getLogo, POST as postLogo } from './logo/route';

const OTHER = '00000000-0000-4000-8000-0000000000b8';
const OTHER_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xb8, 0xb8]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

const upload = (bytes: Uint8Array<ArrayBuffer>, name = 'logo.png') => {
  const form = new FormData();
  form.append('file', new File([bytes], name));
  return postLogo(new Request('http://test/x', { method: 'POST', body: form }));
};

async function otherCompany() {
  await companyScope();
  const handle = await (globalThis as { nittcamDb?: Promise<DbHandle> }).nittcamDb;
  if (!handle) throw new Error('no db handle');
  await companies.ensure(handle.db, OTHER, { name: 'Başka atölye B38' });
  return forCompany(handle.db, OTHER);
}

let ownKey: string | null = null;
beforeAll(async () => {
  process.env.STORAGE_DIR = mkdtempSync(join(tmpdir(), 'nittcam-logo-b38-'));
  ownKey = (await (await companyScope()).company.get())?.logoKey ?? null;
  const other = await otherCompany();
  await companyStorage(OTHER).put('branding/logo.png', OTHER_PNG);
  await other.company.update({ logoKey: 'branding/logo.png' });
});
afterAll(async () => {
  await (await companyScope()).company.update({ logoKey: ownKey });
  const cache = globalThis as { nittcamDb?: Promise<DbHandle> };
  await (await cache.nittcamDb)?.close();
});

const otherBytes = async () => companyStorage(OTHER).get('branding/logo.png');

describe('B38 tester: logo tenancy', () => {
  it('no own logo → 404, never the other company logo', async () => {
    await deleteLogo();
    const r = await getLogo();
    expect(r.status).toBe(404);
  });

  it('a tampered stored key cannot reach the other company folder', async () => {
    const scope = await companyScope();
    await scope.company.update({ logoKey: `../${OTHER}/branding/logo.png` });
    const r = await getLogo();
    expect(r.status).not.toBe(200);
    expect(r.headers.get('content-type') ?? '').not.toMatch(/^image\//);
    await scope.company.update({ logoKey: null });
  });

  it('own upload and delete leave the other company logo as it was', async () => {
    const ok = await upload(JPEG, 'logo.png');
    expect(ok.status).toBe(200);
    const served = await getLogo();
    expect(served.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(JPEG);
    expect(await otherBytes()).toEqual(OTHER_PNG);
    await deleteLogo();
    expect((await getLogo()).status).toBe(404);
    expect(await otherBytes()).toEqual(OTHER_PNG);
    const other = await otherCompany();
    expect((await other.company.get())?.logoKey).toBe('branding/logo.png');
  });
});

describe('B38 tester: logo type and size edges', () => {
  it('SVG, GIF and HTML named .png are refused by their bytes', async () => {
    const enc = (s: string) => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;
    for (const bytes of [
      enc('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      enc('GIF89a\x01\x00\x01\x00'),
      enc('<!doctype html><script>alert(1)</script>'),
    ]) {
      const r = await upload(bytes, 'logo.png');
      expect(r.status).toBe(400);
      expect(((await r.json()) as { error: string }).error).toBe('type');
    }
  });

  it('exactly 512 KB is accepted, one byte more refused', async () => {
    const at = (n: number) => {
      const b = new Uint8Array(n);
      b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      return b;
    };
    expect((await upload(at(LOGO_MAX_BYTES))).status).toBe(200);
    const over = await upload(at(LOGO_MAX_BYTES + 1));
    expect([400, 413]).toContain(over.status);
    expect(((await over.json()) as { error: string }).error).toBe('size');
    await deleteLogo();
  });
});
