/**
 * Pure helpers of the cut-list grid (T118, T119; spec §4.1): cell text ↔ values, validation and
 * spreadsheet-style keyboard navigation. No React here, so the rules are unit-tested.
 */
import {
  defaultSheet,
  parseCutListNumber,
  signedArea,
  type Part,
  type Project,
} from '@nittcam/core';

export type EdgeKey = 'top' | 'right' | 'bottom' | 'left';

/** Grid order of the edge band columns: Üst, Alt, Sol, Sağ (T011b, Q002). */
export const EDGES: readonly EdgeKey[] = ['top', 'bottom', 'left', 'right'];

/**
 * Keyboard-navigable columns, left to right. With `wideBands` the four edge band columns are
 * separate cells; otherwise one "Bant" cell opens the four inputs (compact density, T118). The
 * "Grup" column (T123) is left out of the narrow (tablet) grid.
 */
export function navColumns(wideBands: boolean, group = true): string[] {
  return [
    'name',
    'w',
    'h',
    'qty',
    'grain',
    ...(wideBands ? EDGES.map((e) => `edge-${e}`) : ['band']),
    'note',
    ...(group ? ['group'] : []),
    'actions',
  ];
}

/**
 * Container width (px) from which the four edge band columns are shown separately: the wide
 * columns with the "Grup" column (T123) need 1 064 px; a 1440 px screen leaves about 1 150 px.
 */
export const WIDE_BANDS_MIN = 1080;

/**
 * Container width (px) below which the grid uses narrow columns (tablets, 640–1023 px screens):
 * the compact columns with "Grup" (T123) need 824 px, a 768 px screen with the sidebar leaves
 * about 494 px; the narrow columns (no "Grup") need 488 px.
 */
export const NARROW_GRID_MAX = 840;

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

/** Area of one piece in mm² (rect: w × h minus the rounded corners; freeform: outline − inners). */
export function partArea(part: Part): number {
  if (part.kind === 'rect') {
    const { w, h, r } = part.params;
    return w * h - (4 - Math.PI) * r * r;
  }
  const outer = Math.abs(signedArea({ vertices: part.outline, closed: true }));
  const inner = part.inners.reduce(
    (sum, c) => sum + Math.abs(signedArea({ vertices: c, closed: true })),
    0,
  );
  return outer - inner;
}

export interface CutListSummary {
  rows: number;
  pieces: number;
  /** Total part area in m² (every copy counted). */
  areaM2: number;
  /** Rough sheet count: total area / usable sheet area (inside the margin), rounded up. */
  sheets: number;
}

/** Footer numbers of the cut list (T119). The sheet count is an estimate, not a nesting result. */
export function cutListSummary(
  project: Pick<Project, 'parts' | 'stock' | 'nesting'>,
): CutListSummary {
  const { parts } = project;
  // P3 (CTO #9): a name-only row (no size yet) is not a piece to cut, so it is not counted.
  const pieces = parts.reduce((sum, p) => sum + (partArea(p) > 0 ? p.qty : 0), 0);
  const area = parts.reduce((sum, p) => sum + partArea(p) * p.qty, 0);
  const m = project.nesting.margin;
  const usable =
    Math.max(0, defaultSheet(project).width - 2 * m) *
    Math.max(0, defaultSheet(project).height - 2 * m);
  const sheets = area > 0 && usable > 0 ? Math.ceil(area / usable - 1e-9) : 0;
  return { rows: parts.length, pieces, areaM2: area / 1e6, sheets };
}

/** Grain choice of the bulk edit (T119): keep, or set free / fixed. */
export type GrainChoice = '__keep__' | 'free' | 'fixed';

/** `updateParts` params from the bulk-edit form (T119); `null` when nothing is to change. */
export function bulkParams(
  ids: readonly string[],
  form: {
    qty: number | null;
    grain: GrainChoice;
    angle: number;
    edges: Record<EdgeKey, number | null>;
    prefix: string;
  },
): Record<string, unknown> | null {
  const params: Record<string, unknown> = { ids };
  if (form.qty !== null) params.qty = form.qty;
  if (form.grain !== '__keep__') params.grain = { mode: form.grain, angle: form.angle };
  const band = Object.fromEntries(
    EDGES.flatMap((e) => (form.edges[e] === null ? [] : [[e, form.edges[e]]])),
  );
  if (Object.keys(band).length > 0) params.edgeBand = band;
  if (form.prefix !== '') params.namePrefix = form.prefix;
  return Object.keys(params).length > 1 ? params : null;
}
