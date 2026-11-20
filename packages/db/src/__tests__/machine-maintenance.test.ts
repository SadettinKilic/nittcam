/**
 * T181: the manual maintenance log lives in `machines.maintenance_log` (jsonb, no migration):
 * validated by core, appended sorted, tenant-scoped.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DbHandle } from '../client';
import { seedDefaultProfile } from '../seed';
import { forCompany, InvalidMaintenanceEntry, type CompanyScope } from '../tenant';
import { newCompany, openTestDb } from './helpers';

let h: DbHandle;
let a: CompanyScope;
let b: CompanyScope;

beforeAll(async () => {
  h = await openTestDb();
  a = forCompany(h.db, (await newCompany(h, 'A')).id);
  b = forCompany(h.db, (await newCompany(h, 'B')).id);
});
afterAll(async () => {
  await h.close();
});

describe('machines maintenance log (T181)', () => {
  it('starts empty, appends sorted entries, rejects bad ones', async () => {
    const { machine } = await seedDefaultProfile(a);
    expect(await a.machines.maintenance(machine.id)).toEqual([]);
    await a.machines.addMaintenance(machine.id, {
      date: '2026-11-01',
      intervalDays: 30,
      note: ' yağlama ',
    });
    const log = await a.machines.addMaintenance(machine.id, {
      date: '2026-09-01',
      intervalDays: 90,
      note: '',
    });
    expect(log?.map((e) => e.date)).toEqual(['2026-09-01', '2026-11-01']);
    expect(log?.[1]?.note).toBe('yağlama');
    await expect(
      a.machines.addMaintenance(machine.id, { date: '2026-13-01', intervalDays: 30, note: '' }),
    ).rejects.toBeInstanceOf(InvalidMaintenanceEntry);
    expect((await a.machines.getWithProfile(machine.id))?.machine.maintenanceLog).toHaveLength(2);
  });

  it('another company can neither read nor write the log', async () => {
    const { machine } = await seedDefaultProfile(a);
    expect(await b.machines.maintenance(machine.id)).toBeNull();
    expect(
      await b.machines.addMaintenance(machine.id, {
        date: '2026-11-01',
        intervalDays: 1,
        note: '',
      }),
    ).toBeNull();
    expect(await a.machines.maintenance(machine.id)).toEqual([]);
  });
});
