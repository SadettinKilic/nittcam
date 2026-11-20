/**
 * T289: PATCH /api/machines/:id `{ archived }` archives / restores; the list carries `archived`;
 * an archived machine still opens by id (old projects); bad bodies → 400, unknown ids → 404.
 */
import { randomUUID } from 'node:crypto';
import type { DbHandle } from '@nittcam/db';
import { afterAll, describe, expect, it } from 'vitest';
import { companyScope } from '../../../lib/server/company';
import { pickableMachines, type MachineListItem } from '../../../lib/machines-api';
import { GET as getOne, PATCH } from './[id]/route';
import { GET as list } from './route';

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (id: string, body: unknown) =>
  PATCH(
    new Request('http://test/x', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    ctx(id),
  );
const listed = async (id: string) =>
  ((await (await list()).json()) as MachineListItem[]).find((m) => m.id === id);

afterAll(async () => {
  const cache = globalThis as { nittcamDb?: Promise<DbHandle> };
  await (await cache.nittcamDb)?.close();
});

describe('PATCH /api/machines/:id (T289)', () => {
  it('archives and restores; the archived machine still opens by id', async () => {
    const scope = await companyScope();
    const [seeded] = await scope.machines.listWithProfiles();
    if (!seeded) throw new Error('no seeded machine');
    const p = structuredClone(seeded.profile);
    p.example = false;
    p.identity.name = `Arşiv ${randomUUID().slice(0, 6)}`;
    const { machine } = await scope.machines.createWithProfile(p);

    expect((await listed(machine.id))?.archived).toBe(false);
    const res = await patch(machine.id, { archived: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: machine.id, archived: true });
    const item = await listed(machine.id);
    expect(item?.archived).toBe(true);
    expect(pickableMachines(item ? [item] : [])).toEqual([]);
    expect(pickableMachines(item ? [item] : [], machine.id)).toHaveLength(1);
    expect((await getOne(new Request('http://test/x'), ctx(machine.id))).status).toBe(200);

    expect(await (await patch(machine.id, { archived: false })).json()).toEqual({
      id: machine.id,
      archived: false,
    });
    expect((await listed(machine.id))?.archived).toBe(false);
  });

  it('rejects bad bodies and unknown ids', async () => {
    const scope = await companyScope();
    const [seeded] = await scope.machines.listWithProfiles();
    if (!seeded) throw new Error('no seeded machine');
    expect((await patch(seeded.machine.id, { archived: 'yes' })).status).toBe(400);
    expect((await patch(seeded.machine.id, 'not json')).status).toBe(400);
    expect((await patch(randomUUID(), { archived: true })).status).toBe(404);
    expect((await patch('nope', { archived: true })).status).toBe(404);
  });
});
