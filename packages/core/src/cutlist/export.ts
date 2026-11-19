/**
 * Cut list → CSV (T120, spec §4.1): semicolon-separated, Turkish decimal comma, UTF-8 BOM and
 * CRLF, so Excel opens it with Turkish settings and `parseCutList` reads it back to the same parts.
 */
import type { Part } from '../schema';

/** Header row of the export. Every name is a header `parseCutList` maps (see HEADER_NAMES). */
export const CUT_LIST_CSV_HEADER = [
  'Ad',
  'En (mm)',
  'Boy (mm)',
  'Adet',
  'Damar',
  'Damar açısı',
  'Üst bant',
  'Alt bant',
  'Sol bant',
  'Sağ bant',
  'Not',
] as const;

/** UTF-8 byte order mark: Excel then reads the file as UTF-8 (Turkish letters). */
const BOM = String.fromCharCode(0xfeff);

/**
 * A number with a decimal comma and no grouping (3 decimals at most, as stored; T267). A value
 * like `0,001` or `123,456` looks like a thousands group, and the import reads it as 1 or 123456
 * when other cells (a note "1.5") make it pick the decimal dot. Such values get one trailing zero
 * (`0,0010`): four decimals are never a thousands group, and a spreadsheet shows the same number.
 */
export function csvNumber(v: number): string {
  const s = String(Math.round(v * 1000) / 1000);
  const [int = '', frac] = s.split('.');
  const groupLike = frac?.length === 3 && int.replace('-', '').length <= 3;
  return (groupLike ? `${s}0` : s).replace('.', ',');
}

/**
 * Text that a spreadsheet would read as a formula (spec §8.6, CSV injection): it starts with
 * `=`, `+`, `-`, `@`, a tab or a CR, possibly after apostrophes already there. Such text gets
 * one leading `'`, which `parseCutList` strips again (`unescapeCsvText`). Only text cells pass
 * here; number cells are written by `csvNumber` and never escaped.
 */
const CSV_FORMULA_START = /^'*[=+\-@\t\r]/;

/** RFC 4180 quoting for `;` CSV: quote when the cell holds `;`, `"`, a line break or edge spaces. */
function cell(raw: string): string {
  const text = CSV_FORMULA_START.test(raw) ? `'${raw}` : raw;
  return /[;"\r\n\t]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export interface CutListCsv {
  /** File content, starting with the UTF-8 BOM. */
  text: string;
  /** Rows written (rectangle parts). */
  rows: number;
  /** Freeform parts left out: their shape is not a cut-list row. */
  skipped: number;
}

/** Writes the rectangle parts as CSV rows in project order. */
export function cutListToCsv(parts: readonly Part[]): CutListCsv {
  const lines = [CUT_LIST_CSV_HEADER.join(';')];
  let skipped = 0;
  for (const p of parts) {
    if (p.kind !== 'rect') {
      skipped += 1;
      continue;
    }
    lines.push(
      [
        cell(p.name),
        csvNumber(p.params.w),
        csvNumber(p.params.h),
        String(p.qty),
        p.grain.mode === 'fixed' ? 'evet' : 'hayır',
        csvNumber(p.grain.angle),
        csvNumber(p.edgeBand.top),
        csvNumber(p.edgeBand.bottom),
        csvNumber(p.edgeBand.left),
        csvNumber(p.edgeBand.right),
        cell(p.note ?? ''),
      ].join(';'),
    );
  }
  return { text: `${BOM}${lines.join('\r\n')}\r\n`, rows: lines.length - 1, skipped };
}
