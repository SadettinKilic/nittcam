/**
 * T269: GET /api/machines/:id?version=n returns that profile version (the wizard previews with
 * the version the project is bound to); without the parameter the latest; a bad or unknown
 * version → 400 / 404.
 */
import { randomUUID } from 'node:crypto';
import type { DbHandle } from '@nittcam/db';
import { afterAll, describe, expect, it } from 'vitest';
import { companyScope } from '../../../lib/server/company';
import type { MachineDetail } from '../../../lib/machines-api';
import { GET } from './[id]/route';

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (id: string, query = '') => GET(new Request(`http://test/x${query}`), ctx(id));

afterAll(async () => {
  const cache = globalThis as { nittcamDb?: Promise<DbHandle> };
  await (await cache.nittcamDb)?.close();
});

describe('GET /api/machines/:id?version=n (T269)', () => {
  it('returns the asked version, the latest without it, 400/404 for bad or unknown versions', async () => {
    const scope = await companyScope();
    const [seeded] = await scope.machines.listWithProfiles();
    if (!seeded) throw new Error('no seeded machine');
    const p = structuredClone(seeded.profile);
    p.example = false;
    p.identity.name = `Router ${randomUUID().slice(0, 6)}`;
    const v1 = await scope.machines.createWithProfile(p);
    const id = v1.machine.id;
    const next = structuredClone(p);
    const mdf = next.materials.find((m) => m.material === 'mdf' && m.thickness === 18);
    if (!mdf) throw new Error('no MDF 18');
    const oldStep = mdf.stepDown;
    mdf.stepDown = oldStep + 3;
    const v2 = await scope.machines.saveProfile(id, next);

    const latest = (await (await get(id)).json()) as MachineDetail;
    expect(latest.version).toBe(v2.version.version);
    const first = await get(id, `?version=${v1.version.version}`);
    expect(first.status).toBe(200);
    const d = (await first.json()) as MachineDetail;
    expect(d.version).toBe(v1.version.version);
    expect(
      d.profile.materials.find((m) => m.material === 'mdf' && m.thickness === 18)?.stepDown,
    ).toBe(oldStep);

    expect((await get(id, '?version=abc')).status).toBe(400);
    expect((await get(id, '?version=0')).status).toBe(400);
    expect((await get(id, '?version=999')).status).toBe(404);
  });
});
