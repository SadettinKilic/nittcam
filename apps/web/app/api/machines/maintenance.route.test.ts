/**
 * T181: GET/POST /api/machines/:id/maintenance. The list item carries the newest entry; bad
 * entries → 400; unknown ids → 404.
 */
import { randomUUID } from 'node:crypto';
import type { DbHandle } from '@nittcam/db';
import { afterAll, describe, expect, it } from 'vitest';
import { companyScope } from '../../../lib/server/company';
import type { MachineListItem } from '../../../lib/machines-api';
import { GET as getLog, POST } from './[id]/maintenance/route';
import { GET as list } from './route';

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (id: string, body: unknown) =>
  POST(
    new Request('http://test/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    ctx(id),
  );

afterAll(async () => {
  const cache = globalThis as { nittcamDb?: Promise<DbHandle> };
  await (await cache.nittcamDb)?.close();
});

describe('/api/machines/:id/maintenance (T181)', () => {
  it('records entries; the list shows the newest; bad bodies 400; unknown 404', async () => {
    const scope = await companyScope();
    const [seeded] = await scope.machines.listWithProfiles();
    if (!seeded) throw new Error('no seeded machine');
    const p = structuredClone(seeded.profile);
    p.example = false;
    p.identity.name = `Bakım ${randomUUID().slice(0, 6)}`;
    const { machine } = await scope.machines.createWithProfile(p);
    const id = machine.id;

    expect(await (await getLog(new Request('http://test/x'), ctx(id))).json()).toEqual({ log: [] });
    expect((await post(id, { date: '2026-10-01', intervalDays: 30, note: 'yağ' })).status).toBe(
      200,
    );
    const res = await post(id, { date: '2026-08-01', intervalDays: 60, note: '' });
    expect(((await res.json()) as { log: unknown[] }).log).toHaveLength(2);

    const item = ((await (await list()).json()) as MachineListItem[]).find((m) => m.id === id);
    expect(item?.maintenance).toEqual({ date: '2026-10-01', intervalDays: 30, note: 'yağ' });

    expect((await post(id, { date: '2026-10-01', intervalDays: 0, note: '' })).status).toBe(400);
    expect((await post(id, 'not json')).status).toBe(400);
    expect(
      (await post(randomUUID(), { date: '2026-10-01', intervalDays: 3, note: '' })).status,
    ).toBe(404);
    expect((await getLog(new Request('http://test/x'), ctx('nope'))).status).toBe(404);
  });
});
