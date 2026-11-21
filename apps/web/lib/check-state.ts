/**
 * T321 (usta 1 + 2): one warning state for the Simülasyon summary chip, the "Uyarılar" box and the
 * export checklist. Framework-free so the rules are unit-tested.
 */
import type { ValidationIssue } from '@nittcam/core';

export type CheckState = 'ok' | 'warn' | 'fail';

/** Errors block (red); no errors but warnings is amber with the count, never the green "geçti". */
export function checkState(errorCount: number, warningCount: number): CheckState {
  if (errorCount > 0) return 'fail';
  return warningCount > 0 ? 'warn' : 'ok';
}

/** Parts missing from the layout (e.g. after a quantity change): a neutral "yeniden diz" state. */
export const RENEST_CODE = 'PART_NOT_IN_LAYOUT';

export interface IssueSummary {
  /** Issues listed as errors / warnings (the "yeniden diz" ones are not). */
  listed: ValidationIssue[];
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  renest: ValidationIssue[];
  /** Validation warnings + the Simülasyon step's toolpath warnings. */
  warningCount: number;
  /** "Sorun bulunmadı" is shown only when this is true. */
  clean: boolean;
}

export function summarizeIssues(
  issues: readonly ValidationIssue[],
  simWarnings: number,
): IssueSummary {
  const renest = issues.filter((i) => i.code === RENEST_CODE);
  const listed = issues.filter((i) => i.code !== RENEST_CODE);
  const errors = listed.filter((i) => i.severity === 'error');
  const warnings = listed.filter((i) => i.severity === 'warning');
  return {
    listed,
    errors,
    warnings,
    renest,
    warningCount: warnings.length + simWarnings,
    clean: issues.length === 0 && simWarnings === 0,
  };
}

/** A cut-list row whose only issue is "not in the layout" gets the neutral mark. */
export function renestOnly(issues: readonly Pick<ValidationIssue, 'code'>[]): boolean {
  return issues.length > 0 && issues.every((i) => i.code === RENEST_CODE);
}

/** A manual tool changer without a park point: at a change the tool stops over the sheet. */
export function parkOff(profile: {
  toolChanger: { type: string; park?: { enabled: boolean } | undefined };
}): boolean {
  return profile.toolChanger.type === 'manual' && profile.toolChanger.park?.enabled !== true;
}
