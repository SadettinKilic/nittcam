import { maintenanceStatus, type MaintenanceEntry, type MaintenanceStatus } from '@nittcam/core';
import { fill } from './fill';
import type { Messages } from './messages';

type Text = Messages['machines']['maintenance'];

/** Local calendar day as `YYYY-MM-DD` (the workshop's "today"). */
export function localDay(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const dayFormat = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeZone: 'UTC' });

/** `2026-11-20` → "20 Kas 2026". */
export function formatDay(date: string): string {
  return dayFormat.format(new Date(`${date}T00:00:00Z`));
}

export interface MaintenanceView {
  status: MaintenanceStatus;
  tone: 'neutral' | 'success' | 'warning' | 'danger';
  /** Short badge text. */
  label: string;
  /** Due date detail, empty when nothing is recorded. */
  detail: string;
  /** Overdue or soon: shown as a reminder badge on Makineler and Ana sayfa. */
  remind: boolean;
}

/** T181: what the maintenance reminder shows for the newest entry on `today`. */
export function maintenanceView(
  latest: MaintenanceEntry | null,
  today: string,
  t: Text,
): MaintenanceView {
  const status = maintenanceStatus(latest, today);
  if (status.state === 'none') {
    return { status, tone: 'neutral', label: t.none, detail: '', remind: false };
  }
  const date = formatDay(status.dueDate);
  if (status.state === 'overdue') {
    return {
      status,
      tone: 'danger',
      label: t.overdue,
      detail: fill(t.overdueDetail, { days: -status.daysLeft, date }),
      remind: true,
    };
  }
  if (status.state === 'soon') {
    return {
      status,
      tone: 'warning',
      label: t.soon,
      detail:
        status.daysLeft === 0
          ? fill(t.todayDetail, { date })
          : fill(t.soonDetail, { days: status.daysLeft, date }),
      remind: true,
    };
  }
  return { status, tone: 'success', label: fill(t.ok, { date }), detail: '', remind: false };
}
