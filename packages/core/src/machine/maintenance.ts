/**
 * Manual maintenance log of a machine (T181, spec §3.4 "manuel bakım kaydı (son bakım tarihi,
 * aralık, hatırlatma)", §9.1). The machine is offline, so nothing is measured: the user records
 * when maintenance was done and how many days the next one is due after. The newest entry decides
 * the reminder. Pure: "today" is passed in by the caller (D-011, no clock in core).
 */
import { z } from 'zod';
import { dayNumber } from './maintenance-status';

export {
  MAINTENANCE_SOON_DAYS,
  dayNumber,
  isoDay,
  maintenanceStatus,
  type MaintenanceStatus,
} from './maintenance-status';

export const MAINTENANCE_NOTE_MAX = 500;
export const MAINTENANCE_INTERVAL_MAX = 3650;
/** Entries kept per machine (oldest dropped first). */
export const MAINTENANCE_LOG_MAX = 50;

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
