import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MAINTENANCE_SOON_DAYS,
  dayNumber,
  isoDay,
  latestMaintenance,
  maintenanceStatus,
} from './maintenance';

// Tester (B38, T181): badge boundaries on a fixed "today", across month, year and leap days.

const at = (date: string, intervalDays: number, today: string) =>
  maintenanceStatus(latestMaintenance([{ date, intervalDays, note: '' } as never]), today);

describe('maintenance badge boundaries (tester, T181)', () => {
  it('8 days left ok, 7 soon, 0 soon, −1 overdue', () => {
    expect(at('2026-11-01', 30, '2026-11-23')).toMatchObject({ state: 'ok', daysLeft: 8 });
    expect(at('2026-11-01', 30, '2026-11-24')).toMatchObject({ state: 'soon', daysLeft: 7 });
    expect(at('2026-11-01', 30, '2026-12-01')).toMatchObject({ state: 'soon', daysLeft: 0 });
    expect(at('2026-11-01', 30, '2026-12-02')).toMatchObject({ state: 'overdue', daysLeft: -1 });
  });

  it('year rollover and leap day', () => {
    expect(at('2026-12-25', 10, '2027-01-04')).toMatchObject({
      dueDate: '2027-01-04',
      daysLeft: 0,
    });
    expect(at('2028-02-28', 1, '2028-02-29')).toMatchObject({ dueDate: '2028-02-29', daysLeft: 0 });
    expect(at('2027-02-28', 1, '2027-03-01')).toMatchObject({ dueDate: '2027-03-01', daysLeft: 0 });
    expect(dayNumber('2027-02-29')).toBeNull();
  });

  it('an impossible today or log date is "none", never a wrong badge', () => {
    expect(at('2026-11-01', 30, '2026-02-30')).toEqual({ state: 'none' });
    expect(at('2026-13-01', 30, '2026-11-01')).toEqual({ state: 'none' });
  });

  it('property: due = date + interval, state follows daysLeft', () => {
    const base = dayNumber('2020-01-01') as number;
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 4000 }),
        fc.integer({ min: 1, max: 3650 }),
        fc.integer({ min: -30, max: 4000 }),
        (d, interval, offset) => {
          const date = isoDay(base + d);
          const today = isoDay(base + d + offset);
          const s = at(date, interval, today);
          if (s.state === 'none') throw new Error('valid dates gave none');
          expect(s.dueDate).toBe(isoDay(base + d + interval));
          expect(s.daysLeft).toBe(interval - offset);
          const want =
            s.daysLeft < 0 ? 'overdue' : s.daysLeft <= MAINTENANCE_SOON_DAYS ? 'soon' : 'ok';
          expect(s.state).toBe(want);
        },
      ),
    );
  });
});
