/**
 * T191 (D-087, D-088): the extended field-test program is offered with the §7.3 programs, follows
 * the same order (its test cut after the air cut) and every served test file is recorded on the
 * machine.
 */
import { randomUUID } from 'node:crypto';
import type { DbHandle } from '@nittcam/db';
import { afterAll, describe, expect, it } from 'vitest';
import { companyScope } from '../../../lib/server/company';
import type { VerificationOverview } from '../../../lib/verification-api';
import { GET as download } from './[id]/verification/[kind]/[name]/route';
import { GET as overview } from './[id]/verification/route';

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

async function machine() {
  const scope = await companyScope();
  const [seeded] = await scope.machines.listWithProfiles();
  if (!seeded) throw new Error('no seeded machine');
  const p = structuredClone(seeded.profile);
  p.example = false;
  p.identity.name = `Router ${randomUUID().slice(0, 6)}`;
  return (await scope.machines.createWithProfile(p)).machine.id;
}

async function view(id: string): Promise<VerificationOverview> {
  const res = await overview(new Request('http://test'), ctx(id));
  expect(res.status).toBe(200);
  return (await res.json()) as VerificationOverview;
}

afterAll(async () => {
  const cache = globalThis as { nittcamDb?: Promise<DbHandle> };
  await (await cache.nittcamDb)?.close();
});

describe('field-test kit programs (T191)', () => {
  it('offers the extended part; its test cut waits for the air cut', async () => {
    const id = await machine();
    const o = await view(id);
    expect(o.extended.info?.holePitch).toBe(100);
    expect(o.extended.airCut.ok).toBe(true);
    expect(o.extended.airCut.allowed).toBe(true);
    expect(o.extended.airCut.files[0]?.downloadUrl).toContain('/verification/extAirCut/');
    expect(o.extended.testCut.ok).toBe(true);
    expect(o.extended.testCut.allowed).toBe(false);
    expect(o.downloads).toEqual([]);

    const name = o.extended.testCut.files[0]?.name ?? '';
    const blocked = await download(new Request('http://test?accept=1'), {
      params: Promise.resolve({ id, kind: 'extTestCut', name }),
    });
    expect(blocked.status).toBe(409);
  });

  it('a served file is recorded; a refused one is not', async () => {
    const id = await machine();
    const o = await view(id);
    const name = o.extended.airCut.files[0]?.name ?? '';
    const params = { params: Promise.resolve({ id, kind: 'extAirCut', name }) };
    // Without the acceptance of the unverified warning: refused, nothing recorded.
    expect((await download(new Request('http://test'), params)).status).toBe(428);
    expect((await view(id)).downloads).toEqual([]);
    const res = await download(new Request('http://test?accept=1'), {
      params: Promise.resolve({ id, kind: 'extAirCut', name }),
    });
    expect(res.status).toBe(200);
    const after = await view(id);
    expect(after.downloads).toHaveLength(1);
    expect(after.downloads[0]).toMatchObject({ kind: 'extAirCut', name, version: 1 });
    expect(after.downloads[0]?.sha256).toBe(o.extended.airCut.files[0]?.hash);
  });
});
