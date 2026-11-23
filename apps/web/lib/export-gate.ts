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
  /** Unverified ready-template values are checked by hand (T282); only asked when there are any. */
  templates: boolean;
  /** Feeds far above the recommendation are meant (T330); only asked when there are any. */
  feeds?: boolean;
  /** The file uses an older machine profile version on purpose (T332); only asked then. */
  stale?: boolean;
  /** The vacuum is switched on by hand (T336); only asked when the program writes no code. */
  vacuum?: boolean;
}

export const EMPTY_CHECKLIST: ChecklistState = {
  origin: false,
  tool: false,
  airCut: false,
  toolChange: false,
  templates: false,
  feeds: false,
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
  /** Unverified ready templates in the project (T282); each needs the templates line ticked. */
  unverifiedTemplates = 0,
): DownloadBlocker | null {
  if (!preview || !preview.ok || preview.files.length === 0) return 'checks';
  if (!checklist.origin || !checklist.tool || !checklist.airCut) return 'checklist';
  if ((preview.checklist?.toolChanges ?? 0) > 0 && !checklist.toolChange) return 'checklist';
  if (unverifiedTemplates > 0 && !checklist.templates) return 'checklist';
  if ((preview.checklist?.highFeeds?.length ?? 0) > 0 && !checklist.feeds) return 'checklist';
  if (preview.checklist?.staleProfile && !checklist.stale) return 'checklist';
  if (preview.checklist?.vacuumByHand && !checklist.vacuum) return 'checklist';
  if (preview.needsAcceptance && !accepted) return 'accept';
  return null;
}

/** Error count shown for a failed run (at least 1: a failed run always has a reason). */
export function errorCount(preview: Pick<ExportPreview, 'violations'>): number {
  return Math.max(1, preview.violations.filter((v) => v.severity === 'error').length);
}
