/**
 * Pure helpers of the cut-list grid (T118, T119; spec §4.1): cell text ↔ values, validation and
 * spreadsheet-style keyboard navigation. No React here, so the rules are unit-tested.
 */
import { parseCutListNumber, type Part } from '@nittcam/core';

export type EdgeKey = 'top' | 'right' | 'bottom' | 'left';

/** Grid order of the edge band columns: Üst, Alt, Sol, Sağ (T011b, Q002). */
export const EDGES: readonly EdgeKey[] = ['top', 'bottom', 'left', 'right'];

/**
 * Keyboard-navigable columns, left to right. With `wideBands` the four edge band columns are
 * separate cells; otherwise one "Bant" cell opens the four inputs (compact density, T118).
 */
export function navColumns(wideBands: boolean): string[] {
  return [
    'name',
    'w',
    'h',
    'qty',
    'grain',
    ...(wideBands ? EDGES.map((e) => `edge-${e}`) : ['band']),
    'note',
    'actions',
  ];
}

/** Container width (px) from which the four edge band columns are shown separately. */
export const WIDE_BANDS_MIN = 1040;

/** DOM id of a grid cell (input or button), used for keyboard navigation. */
export function cellId(row: number, col: string): string {
  return `cl-${row}-${col}`;
}

/** Numbers in inputs: Turkish decimal comma, no grouping. */
export function formatInput(v: number): string {
  return String(v).replace('.', ',');
}

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

export interface CellErrors {
  number: string;
  positive: string;
  qty: string;
  band: string;
}

export function validatePositive(e: CellErrors, text: string): Validated<number> {
  const n = parseCutListNumber(text, 'comma');
  if (n === null) return { ok: false, error: e.number };
  if (n <= 0) return { ok: false, error: e.positive };
  return { ok: true, value: n };
}

export function validateQty(e: CellErrors, text: string): Validated<number> {
  const n = parseCutListNumber(text, 'comma');
  if (n === null || !Number.isInteger(n) || n < 1) return { ok: false, error: e.qty };
  return { ok: true, value: n };
}

export function validateBand(e: CellErrors, text: string): Validated<number> {
  if (text.trim() === '') return { ok: true, value: 0 };
  const n = parseCutListNumber(text, 'comma');
  if (n === null || n < 0) return { ok: false, error: e.band };
  return { ok: true, value: n };
}

export type NavDirection = 'up' | 'down' | 'left' | 'right' | 'next' | 'prev';

/** Where a navigation key leads: another cell, a new row (Enter on the last row) or nowhere. */
export type NavTarget = { row: number; col: string } | { append: true; col: string } | null;

/**
 * Spreadsheet navigation: arrows stop at the edges; Tab / Shift+Tab wrap to the next / previous
 * row; Enter (`down`) on the last row asks for a new row in the same column.
 */
export function navTarget(
  row: number,
  col: string,
  dir: NavDirection,
  rows: number,
  cols: readonly string[],
  enter = false,
): NavTarget {
  const c = cols.indexOf(col);
  if (c < 0 || rows === 0) return null;
  switch (dir) {
    case 'up':
      return row > 0 ? { row: row - 1, col } : null;
    case 'down':
      if (row < rows - 1) return { row: row + 1, col };
      return enter ? { append: true, col } : null;
    case 'left':
      return c > 0 ? { row, col: cols[c - 1] as string } : null;
    case 'right':
      return c < cols.length - 1 ? { row, col: cols[c + 1] as string } : null;
    case 'next':
      if (c < cols.length - 1) return { row, col: cols[c + 1] as string };
      return row < rows - 1 ? { row: row + 1, col: cols[0] as string } : null;
    case 'prev':
      if (c > 0) return { row, col: cols[c - 1] as string };
      return row > 0 ? { row: row - 1, col: cols[cols.length - 1] as string } : null;
  }
}

/** Number of edges with a band, for the compact "Bant" cell glyph and its label. */
export function bandedEdges(part: Pick<Part, 'edgeBand'>): EdgeKey[] {
  return EDGES.filter((e) => part.edgeBand[e] > 0);
}
