/**
 * Maintenance reminder state (T181). Its own module without zod (T186) so the Makineler list and
 * Ana sayfa badges stay light; the log schema lives in `maintenance.ts`. Pure: "today" comes from
 * the caller (D-011).
 */
import type { MaintenanceEntry } from './maintenance';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Days before the due date from which the reminder shows "yaklaşıyor". */
export const MAINTENANCE_SOON_DAYS = 7;

/** Days since 1970-01-01 of a valid `YYYY-MM-DD` date, else `null`. */
export function dayNumber(date: string): number | null {
  if (!ISO_DATE.test(date)) return null;
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return Math.round(ms / 86_400_000);
}

/** `YYYY-MM-DD` of a day number (inverse of `dayNumber`). */
export function isoDay(day: number): string {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

export type MaintenanceStatus =
  { state: 'none' } | { state: 'ok' | 'soon' | 'overdue'; dueDate: string; daysLeft: number };

/**
 * Reminder state on `today` (`YYYY-MM-DD`): `overdue` after the due date, `soon` within
 * `MAINTENANCE_SOON_DAYS` (the due day itself included), else `ok`. `none` without a log.
 */
export function maintenanceStatus(
  latest: MaintenanceEntry | null,
  today: string,
): MaintenanceStatus {
  const now = dayNumber(today);
  const last = latest ? dayNumber(latest.date) : null;
  if (!latest || now === null || last === null) return { state: 'none' };
  const due = last + latest.intervalDays;
  const daysLeft = due - now;
  const dueDate = isoDay(due);
  if (daysLeft < 0) return { state: 'overdue', dueDate, daysLeft };
  if (daysLeft <= MAINTENANCE_SOON_DAYS) return { state: 'soon', dueDate, daysLeft };
  return { state: 'ok', dueDate, daysLeft };
}
