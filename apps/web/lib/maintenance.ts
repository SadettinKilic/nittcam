import { maintenanceStatus, type MaintenanceEntry, type MaintenanceStatus } from '@nittcam/core';
import { fill } from './fill';
import type { Messages } from './messages';

type Text = Messages['machines']['maintenance'];

/**
 * The workshop's time zone (D-086). The home page computes "today" on the server, whose clock is
 * often UTC, and the Makineler page renders first on the server too: both use this zone, so the
 * day matches the workshop's calendar and the server and browser renders agree.
 */
export const WORKSHOP_TIME_ZONE = process.env.NEXT_PUBLIC_WORKSHOP_TIME_ZONE ?? 'Europe/Istanbul';

/** The workshop's calendar day as `YYYY-MM-DD` (its "today"), in `timeZone`. */
export function localDay(now: Date = new Date(), timeZone: string = WORKSHOP_TIME_ZONE): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
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
