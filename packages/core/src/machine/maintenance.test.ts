import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  MAINTENANCE_LOG_MAX,
  addMaintenanceEntry,
  dayNumber,
  isoDay,
  latestMaintenance,
  maintenanceStatus,
  parseMaintenanceLog,
} from './maintenance';

const entry = (date: string, intervalDays = 30, note = '') => ({ date, intervalDays, note });

describe('maintenance log (T181)', () => {
  it('dayNumber rejects impossible dates and round-trips with isoDay', () => {
    expect(dayNumber('2026-02-30')).toBeNull();
    expect(dayNumber('2026-1-5')).toBeNull();
    expect(isoDay(dayNumber('2028-02-29') ?? 0)).toBe('2028-02-29');
    fc.assert(fc.property(fc.integer({ min: 0, max: 60_000 }), (d) => dayNumber(isoDay(d)) === d));
  });

  it('parse skips invalid entries and sorts by date', () => {
    const log = parseMaintenanceLog([
      entry('2026-10-01'),
      { date: 'yesterday', intervalDays: 3, note: '' },
      entry('2026-01-01', 0),
      entry('2025-12-01'),
      'junk',
    ]);
    expect(log.map((e) => e.date)).toEqual(['2025-12-01', '2026-10-01']);
    expect(parseMaintenanceLog(null)).toEqual([]);
  });

  it('latest + status: ok, soon (due day included), overdue, none', () => {
    const latest = latestMaintenance([entry('2026-09-01', 90), entry('2026-11-01', 30)]);
    expect(latest?.date).toBe('2026-11-01');
    expect(maintenanceStatus(latest, '2026-11-10')).toEqual({
      state: 'ok',
      dueDate: '2026-12-01',
      daysLeft: 21,
    });
    expect(maintenanceStatus(latest, '2026-11-24').state).toBe('soon');
    expect(maintenanceStatus(latest, '2026-12-01')).toMatchObject({ state: 'soon', daysLeft: 0 });
    expect(maintenanceStatus(latest, '2026-12-02')).toMatchObject({
      state: 'overdue',
      daysLeft: -1,
    });
    expect(maintenanceStatus(null, '2026-12-02')).toEqual({ state: 'none' });
  });

  it('add keeps the log sorted and bounded', () => {
    let log = parseMaintenanceLog([]);
    for (let i = 0; i < MAINTENANCE_LOG_MAX + 5; i++) {
      log = addMaintenanceEntry(log, entry(isoDay(20_000 + i)));
    }
    expect(log).toHaveLength(MAINTENANCE_LOG_MAX);
    expect(log.at(-1)?.date).toBe(isoDay(20_000 + MAINTENANCE_LOG_MAX + 4));
  });
});
