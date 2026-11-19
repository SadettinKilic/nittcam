/**
 * Cut-list files (T120, spec §4.1, §8.6): type and size check, CSV decoding, XLSX rows → the
 * tab text the paste parser reads, and the CSV download. The XLSX reader (read-excel-file, MIT)
 * is loaded only when an .xlsx file is chosen, so it stays out of the main bundle.
 */
import { headerField } from '@nittcam/core';

/** Largest file the import accepts (§8.6 upload limits). */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export type CutListFileKind = 'csv' | 'xlsx';
export type CutListFileError = 'type' | 'size' | 'empty' | 'read';

/** The kind of a chosen file from its name (browsers report MIME types unreliably for CSV). */
export function cutListFileKind(name: string): CutListFileKind | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (ext === 'csv' || ext === 'txt' || ext === 'tsv') return 'csv';
  if (ext === 'xlsx') return 'xlsx';
  return null;
}

/** First bytes of every .xlsx file (a ZIP archive). */
function isZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/**
 * CSV bytes → text: UTF-8 (with or without BOM) first; a file that is not valid UTF-8 is read as
 * Windows-1254, the code page Turkish Excel uses for "CSV (virgülle ayrılmış)".
 */
export function decodeCsv(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  } catch {
    return new TextDecoder('windows-1254').decode(bytes);
  }
}

type Cell = string | number | boolean | Date | null | undefined;

function cellText(v: Cell): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return String(Math.round(v * 1e6) / 1e6).replace('.', ',');
  if (typeof v === 'boolean') return v ? 'evet' : 'hayır';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  // Tabs and line breaks inside a cell would split it in the tab text.
  return String(v)
    .replace(/[\t\r\n]+/g, ' ')
    .trim();
}

/**
 * Spreadsheet rows → tab-separated text for `parseCutList`. Empty rows are dropped, and rows above
 * the header (a title, a merged caption) are skipped when a header row is found in the first ten.
 * Numbers use the Turkish decimal comma, so the parser sees one decimal style.
 */
export function rowsToText(rows: readonly (readonly Cell[])[]): string {
  const lines = rows.map((r) => r.map(cellText)).filter((r) => r.some((c) => c !== ''));
  const header = lines
    .slice(0, 10)
    .findIndex((r) => r.filter((c) => c !== '' && headerField(c) !== null).length >= 2);
  const body = header > 0 ? lines.slice(header) : lines;
  // Columns that are empty in every row (a merged caption's spill) are dropped.
  const width = Math.max(0, ...body.map((r) => r.length));
  const used = Array.from({ length: width }, (_, c) => body.some((r) => (r[c] ?? '') !== ''));
  return body.map((r) => r.filter((_, c) => used[c]).join('\t')).join('\n');
}

/** Reads a chosen or dropped file into cut-list text, or says why it cannot. */
export async function readCutListFile(
  file: File,
): Promise<
  { ok: true; text: string; kind: CutListFileKind } | { ok: false; error: CutListFileError }
> {
  const kind = cutListFileKind(file.name);
  if (!kind) return { ok: false, error: 'type' };
  if (file.size > MAX_IMPORT_BYTES) return { ok: false, error: 'size' };
  if (file.size === 0) return { ok: false, error: 'empty' };
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (kind === 'csv') {
      // A spreadsheet renamed to .csv is still a ZIP: reject it instead of showing binary text.
      if (isZip(bytes)) return { ok: false, error: 'type' };
      const text = decodeCsv(bytes);
      return text.trim() === '' ? { ok: false, error: 'empty' } : { ok: true, text, kind };
    }
    if (!isZip(bytes)) return { ok: false, error: 'type' };
    const { readSheet } = await import('read-excel-file/browser');
    const rows = (await readSheet(bytes.buffer as ArrayBuffer)) as Cell[][];
    const text = rowsToText(rows);
    return text === '' ? { ok: false, error: 'empty' } : { ok: true, text, kind };
  } catch {
    return { ok: false, error: 'read' };
  }
}

/** Saves text as a file in the browser (CSV export). */
export function downloadText(name: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
