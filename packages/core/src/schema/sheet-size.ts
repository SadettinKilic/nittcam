import type { Project, Stock, ProjectSheetSize } from './project';

/**
 * The single reader of sheet sizes (T164, D-056). Everything outside the schema reads a sheet's
 * size through these helpers, never `stock.sheet` directly (`sheet-size.guard.test.ts` checks it).
 */

/** A sheet as the readers need it: its size plus the stock grain (same shape as `stock.sheet`). */
export type SheetSize = Stock['sheet'];

type SizeSource = Pick<Project, 'stock'> & { layout?: Pick<Project['layout'], 'sheets'> };

/** The stock sheet sizes in order; absent `stock.sheets` = `[stock.sheet]` with no limit. */
export function stockSheetSizes(project: Pick<Project, 'stock'>): ProjectSheetSize[] {
  const { sheet, sheets } = project.stock;
  if (sheets && sheets.length > 0) return sheets.map((s) => ({ ...s }));
  return [{ width: sheet.width, height: sheet.height }];
}

/** The default (first) stock sheet: `stock.sheet` with its grain. */
export function defaultSheet(project: Pick<Project, 'stock'>): SheetSize {
  return project.stock.sheet;
}

/**
 * Size of layout sheet `sheetIndex`: its own `size`, else `stock.sheet`. Grain is always the stock
 * grain. An index past the layout also falls back to `stock.sheet`.
 */
export function sheetSizeOf(project: SizeSource, sheetIndex: number): SheetSize {
  const own = project.layout?.sheets[sheetIndex]?.size;
  const base = project.stock.sheet;
  if (!own) return base;
  return { width: own.width, height: own.height, grain: base.grain };
}
