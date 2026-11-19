/**
 * When may the export step download (spec §6.6 checklist, §7.2 rules 9 and 10; T021, D-030)?
 * Framework-free so the gate is unit-tested.
 */
import type { ExportPreview } from './exports-api';

export interface ChecklistState {
  origin: boolean;
  tool: boolean;
  airCut: boolean;
  /** Manual tool changes inside the program are confirmed (T274); only asked when there are any. */
  toolChange: boolean;
}

export const EMPTY_CHECKLIST: ChecklistState = {
  origin: false,
  tool: false,
  airCut: false,
  toolChange: false,
};

/** Why the download is disabled, in the order the user meets them; null = may download. */
export type DownloadBlocker = 'checks' | 'checklist' | 'accept';

export function downloadBlocker(
  preview:
    | (Pick<ExportPreview, 'ok' | 'files' | 'needsAcceptance'> &
        Partial<Pick<ExportPreview, 'checklist'>>)
    | null,
  checklist: ChecklistState,
  accepted: boolean,
): DownloadBlocker | null {
  if (!preview || !preview.ok || preview.files.length === 0) return 'checks';
  if (!checklist.origin || !checklist.tool || !checklist.airCut) return 'checklist';
  if ((preview.checklist?.toolChanges ?? 0) > 0 && !checklist.toolChange) return 'checklist';
  if (preview.needsAcceptance && !accepted) return 'accept';
  return null;
}

/** Error count shown for a failed run (at least 1: a failed run always has a reason). */
export function errorCount(preview: Pick<ExportPreview, 'violations'>): number {
  return Math.max(1, preview.violations.filter((v) => v.severity === 'error').length);
}
