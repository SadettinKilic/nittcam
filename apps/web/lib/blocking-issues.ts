/**
 * T287 (CTO #10 A, K2): the validation errors that stop the NC export, in the shape both the server
 * (`runExport`) and the Simülasyon badge show them. One source, so the two steps never disagree.
 * Framework-free so the mapping is unit-tested.
 */
import { EXPORT_BLOCKING_CODES, type ValidationIssue } from '@nittcam/core';

/** Where a blocking issue is: its sheet, its part (row) and the drawn item of that part. */
export interface IssuePlace {
  sheet?: number;
  partId?: string;
  inner?: number;
  hole?: number;
  openLine?: number;
}

/** Codes about the layout itself, shown under "Dizilim" (not "Takım yolu"). */
const LAYOUT_CODES: ReadonlySet<string> = new Set([...EXPORT_BLOCKING_CODES, 'PART_NOT_IN_LAYOUT']);

/** §7.2 check group of a blocking validation issue. */
export function blockingRule(code: string): 'LAYOUT' | 'TOOLPATH' {
  return LAYOUT_CODES.has(code) ? 'LAYOUT' : 'TOOLPATH';
}

/**
 * The place of a validation path: `layout.sheets[s]...` → sheet; `parts[i].inners|holes|lines[k]`
 * → part + drawn item; any other `parts[i]...` → the part's row (T287: "Satır 2 · Tezgah").
 */
export function issuePlace(parts: readonly { id: string }[], path: string): IssuePlace {
  const sheet = /^layout\.sheets\[(\d+)\]/.exec(path);
  if (sheet) return { sheet: Number(sheet[1]) };
  const m = /^parts\[(\d+)\](?:\.(inners|holes|lines)\[(\d+)\])?/.exec(path);
  const part = m ? parts[Number(m[1])] : undefined;
  if (!m || !part) return {};
  if (m[2] === undefined) return { partId: part.id };
  const k = Number(m[3]);
  if (m[2] === 'inners') return { partId: part.id, inner: k };
  return m[2] === 'holes' ? { partId: part.id, hole: k } : { partId: part.id, openLine: k };
}

export interface BlockingItem extends IssuePlace {
  rule: 'LAYOUT' | 'TOOLPATH';
  code: string;
  severity: 'error';
  /** The engine's English sentence (details only). */
  message: string;
}

/** The blocking errors with their check group and place. */
export function blockingItems(
  parts: readonly { id: string }[],
  issues: readonly ValidationIssue[],
): BlockingItem[] {
  return issues
    .filter((i) => i.severity === 'error')
    .map((i) => ({
      rule: blockingRule(i.code),
      code: i.code,
      severity: 'error' as const,
      message: i.message,
      ...issuePlace(parts, i.path),
    }));
}

/** The fields `withBlocking` compares (a Simülasyon finding). */
export interface Mergeable extends IssuePlace {
  code: string;
}

/** Validation errors about a whole part that is missing from the layout (T287). */
const PART_LEVEL_CODES: ReadonlySet<string> = new Set([
  'PART_NOT_IN_LAYOUT',
  'PART_LARGER_THAN_SHEET',
]);

/**
 * T287 / K2: the run's own findings plus the validation errors that lock Dışa aktar, each issue
 * once. A drawn item (cut-out, hole, line) the toolpath already refused is not repeated under
 * another code; the toolpath's "copies not placed" warning gives way to the named part error.
 */
export function withBlocking<F extends Mergeable>(own: readonly F[], blocking: readonly F[]): F[] {
  const key = (f: F) =>
    f.inner !== undefined || f.hole !== undefined || f.openLine !== undefined
      ? `item/${f.partId ?? ''}/${f.inner ?? ''}/${f.hole ?? ''}/${f.openLine ?? ''}`
      : `${f.code}/${f.partId ?? ''}/${f.sheet ?? ''}`;
  const seen = new Set(own.map(key));
  const extra = blocking.filter((b) => !seen.has(key(b)));
  const named = extra.some((b) => PART_LEVEL_CODES.has(b.code));
  return [...own.filter((f) => !(named && f.code === 'UNPLACED_COPIES')), ...extra];
}
