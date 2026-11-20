import { describe, expect, it } from 'vitest';
import { getMessages } from './messages';
import { localDay, maintenanceView } from './maintenance';

const t = getMessages().machines.maintenance;
const last = { date: '2026-11-01', intervalDays: 30, note: '' };

describe('maintenanceView (T181)', () => {
  it('reminds when overdue or soon, not when ok or empty', () => {
    expect(maintenanceView(null, '2026-11-20', t)).toMatchObject({ remind: false, label: t.none });
    expect(maintenanceView(last, '2026-11-10', t)).toMatchObject({
      remind: false,
      tone: 'success',
    });
    const soon = maintenanceView(last, '2026-11-28', t);
    expect(soon).toMatchObject({ remind: true, tone: 'warning', label: t.soon });
    expect(soon.detail).toContain('3 gün');
    expect(maintenanceView(last, '2026-12-01', t).detail).toContain('Bugün');
    const late = maintenanceView(last, '2026-12-05', t);
    expect(late).toMatchObject({ remind: true, tone: 'danger', label: t.overdue });
    expect(late.detail).toContain('4 gün gecikti');
  });

  it('localDay pads month and day', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});
