/**
 * Manual maintenance log of a machine (T181, spec §3.4 "manuel bakım kaydı (son bakım tarihi,
 * aralık, hatırlatma)", §9.1). The machine is offline, so nothing is measured: the user records
 * when maintenance was done and how many days the next one is due after. The newest entry decides
 * the reminder. Pure: "today" is passed in by the caller (D-011, no clock in core).
 */
import { z } from 'zod';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Days before the due date from which the reminder shows "yaklaşıyor". */
export const MAINTENANCE_SOON_DAYS = 7;
export const MAINTENANCE_NOTE_MAX = 500;
export const MAINTENANCE_INTERVAL_MAX = 3650;
/** Entries kept per machine (oldest dropped first). */
export const MAINTENANCE_LOG_MAX = 50;

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

export const maintenanceEntrySchema = z.strictObject({
  /** Day the maintenance was done, `YYYY-MM-DD`. */
  date: z
    .string({ error: 'must be a date' })
    .refine((d) => dayNumber(d) !== null, { error: 'must be a date like 2026-11-20' }),
  /** Days until the next maintenance is due. */
  intervalDays: z
    .number({ error: 'must be a number' })
    .int({ error: 'must be an integer' })
    .min(1, { error: 'must be at least 1' })
    .max(MAINTENANCE_INTERVAL_MAX, { error: `must be at most ${MAINTENANCE_INTERVAL_MAX}` }),
  note: z
    .string({ error: 'must be text' })
    .trim()
    .max(MAINTENANCE_NOTE_MAX, { error: `at most ${MAINTENANCE_NOTE_MAX} characters` }),
});
export type MaintenanceEntry = z.infer<typeof maintenanceEntrySchema>;

/**
 * Reads a stored log: invalid entries (older data, hand edits) are skipped, never thrown on.
 * Sorted oldest first.
 */
export function parseMaintenanceLog(raw: unknown): MaintenanceEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: MaintenanceEntry[] = [];
  for (const item of raw) {
    const r = maintenanceEntrySchema.safeParse(item);
    if (r.success) out.push(r.data);
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Appends an entry, keeps the log sorted and at most `MAINTENANCE_LOG_MAX` long. */
export function addMaintenanceEntry(
  log: readonly MaintenanceEntry[],
  entry: MaintenanceEntry,
): MaintenanceEntry[] {
  return parseMaintenanceLog([...log, entry]).slice(-MAINTENANCE_LOG_MAX);
}

/** The newest entry (by date; the later one on equal dates), or `null`. */
export function latestMaintenance(log: readonly MaintenanceEntry[]): MaintenanceEntry | null {
  return parseMaintenanceLog(log).at(-1) ?? null;
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
