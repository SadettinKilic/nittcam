/**
 * Tester (B36): tenancy of the new routes. PATCH /api/machines/:id on another company's machine
 * is 404 and leaves it as it was (T289); GET /api/projects/:id/links on another company's project
 * is 404 (T292).
 */
import { randomUUID } from 'node:crypto';
import { companies, forCompany, type DbHandle } from '@nittcam/db';
import { afterAll, describe, expect, it } from 'vitest';
import { newProject } from '../../../lib/draft-project';
import { companyScope } from '../../../lib/server/company';
import { PATCH } from './[id]/route';
import { GET as links } from '../projects/[id]/links/route';
import { GET as getProject } from '../projects/[id]/route';

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const OTHER = '00000000-0000-4000-8000-0000000000b6';

afterAll(async () => {
  const cache = globalThis as { nittcamDb?: Promise<DbHandle> };
  await (await cache.nittcamDb)?.close();
});

async function otherCompany() {
  await companyScope(); // opens the cached handle
  const handle = await (globalThis as { nittcamDb?: Promise<DbHandle> }).nittcamDb;
  if (!handle) throw new Error('no db handle');
  await companies.ensure(handle.db, OTHER, { name: 'Başka atölye B36' });
  return forCompany(handle.db, OTHER);
}

describe('B36 tester: tenancy', () => {
  it('PATCH another company machine → 404, archive state unchanged (T289)', async () => {
    const scope = await companyScope();
    const [seeded] = await scope.machines.listWithProfiles();
    if (!seeded) throw new Error('no seeded machine');
    const other = await otherCompany();
    const p = structuredClone(seeded.profile);
    p.example = false;
    p.identity.name = `Yabancı ${randomUUID().slice(0, 6)}`;
    const { machine } = await other.machines.createWithProfile(p);

    for (const archived of [true, false]) {
      const res = await PATCH(
        new Request('http://test/x', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ archived }),
        }),
        ctx(machine.id),
      );
      expect(res.status).toBe(404);
    }
    const row = (await other.machines.listWithProfiles()).find((m) => m.machine.id === machine.id);
    expect(row?.machine.archivedAt).toBeNull();
    // Archived on its own side: still not reachable from ours.
    await other.machines.setArchived(machine.id, true);
    const res = await PATCH(
      new Request('http://test/x', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ archived: false }),
      }),
      ctx(machine.id),
    );
    expect(res.status).toBe(404);
    const after = (await other.machines.listWithProfiles()).find(
      (m) => m.machine.id === machine.id,
    );
    expect(after?.machine.archivedAt).not.toBeNull();
  });

  it('links of another company project → 404 (T292)', async () => {
    const other = await otherCompany();
    const foreign = await other.projects.create({ name: 'Yabancı', data: newProject() });
    expect((await links(new Request('http://test/x'), ctx(foreign.id))).status).toBe(404);
    expect((await getProject(new Request('http://test/x'), ctx(foreign.id))).status).toBe(404);
    expect((await links(new Request('http://test/x'), ctx(randomUUID()))).status).toBe(404);
    expect((await links(new Request('http://test/x'), ctx('nope'))).status).toBe(404);
  });
});
