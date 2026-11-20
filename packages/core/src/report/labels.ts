/**
 * Part labels (T174, spec §2.4 "Parça numarası ve etiket", §6.6 "etiket sayfası"): one label per
 * piece on an A4 label sheet. Pure: the label grid in mm and the label contents; the server renders
 * them to PDF.
 */
import { z } from 'zod';
import type { Project } from '../schema/project';
import { partNumber } from '../cutlist/part-number';
import { projectReport, type BandEdge, type ReportPartRow } from './report';

/** A4 portrait, mm. Label sheets are always A4. */
export const LABEL_PAGE = { width: 210, height: 297 } as const;

/** Label grid on the sheet, mm; `left` / `top` = page edge to the first label. */
export interface LabelGrid {
  cols: number;
  rows: number;
  width: number;
  height: number;
  left: number;
  top: number;
  gapX: number;
  gapY: number;
}

/**
 * Presets (common A4 label stock): 3 × 8 = 70 × 37 mm with no gaps; 2 × 7 = 99,1 × 38,1 mm with a
 * 2,5 mm column gap.
 */
export const LABEL_PRESETS = {
  'a4-3x8': { cols: 3, rows: 8, width: 70, height: 37, left: 0, top: 0.5, gapX: 0, gapY: 0 },
  'a4-2x7': {
    cols: 2,
    rows: 7,
    width: 99.1,
    height: 38.1,
    left: 4.65,
    top: 15.15,
    gapX: 2.5,
    gapY: 0,
  },
} as const satisfies Record<string, LabelGrid>;
export type LabelPreset = keyof typeof LABEL_PRESETS;
export const LABEL_PRESET_IDS = Object.keys(LABEL_PRESETS) as LabelPreset[];

const mm = (max: number) =>
  z
    .number({ error: 'must be a number' })
    .min(0, { error: 'must be >= 0' })
    .max(max, { error: `must be <= ${max}` });

/** EPS for "the grid fits on the page" (mm). */
const FIT_EPS = 0.01;

/** A custom grid; it must fit on the A4 page. */
export const labelGridSchema = z
  .strictObject({
    cols: z.number().int({ error: 'must be an integer' }).min(1).max(10),
    rows: z.number().int({ error: 'must be an integer' }).min(1).max(30),
    width: mm(LABEL_PAGE.width).refine((v) => v >= 15, { error: 'must be >= 15' }),
    height: mm(LABEL_PAGE.height).refine((v) => v >= 10, { error: 'must be >= 10' }),
    left: mm(100),
    top: mm(100),
    gapX: mm(50),
    gapY: mm(50),
  })
  .superRefine((g, ctx) => {
    if (g.left + g.cols * g.width + (g.cols - 1) * g.gapX > LABEL_PAGE.width + FIT_EPS) {
      ctx.addIssue({ code: 'custom', message: 'grid is wider than A4', path: ['cols'] });
    }
    if (g.top + g.rows * g.height + (g.rows - 1) * g.gapY > LABEL_PAGE.height + FIT_EPS) {
      ctx.addIssue({ code: 'custom', message: 'grid is taller than A4', path: ['rows'] });
    }
  });

/**
 * Print offset calibration, mm (T174): shifts every label; +x = right, +y = down (as measured on
 * the printed test sheet). Kept small: a larger error is a wrong preset, not an offset.
 */
export const labelOffsetSchema = z.strictObject({
  x: z.number().min(-20).max(20),
  y: z.number().min(-20).max(20),
});
export type LabelOffset = z.infer<typeof labelOffsetSchema>;

/** One label cell on the page, mm from the page's top-left corner (offset applied). */
export interface LabelCell {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The cells of one sheet, row by row. */
export function labelCells(grid: LabelGrid, offset: LabelOffset = { x: 0, y: 0 }): LabelCell[] {
  const cells: LabelCell[] = [];
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      cells.push({
        x: grid.left + c * (grid.width + grid.gapX) + offset.x,
        y: grid.top + r * (grid.height + grid.gapY) + offset.y,
        width: grid.width,
        height: grid.height,
      });
    }
  }
  return cells;
}

/** Content of one piece's label. */
export interface PartLabel {
  /** "row.copy" (T171). */
  number: string;
  partId: string;
  name: string;
  finished: ReportPartRow['finished'];
  cut: ReportPartRow['cut'];
  /** Part-frame grain angle, degrees [0, 180); null = free grain. */
  grain: number | null;
  band: ReportPartRow['band'];
  bandedEdges: BandEdge[];
  /** Layout sheet number from 1; null = the copy is not on the layout. */
  sheet: number | null;
}

/**
 * One label per piece (total = sum of `qty`), ordered by sheet, then part number, so the labels
 * come off the printer in the order the sheets are cut; unplaced copies last.
 */
export function partLabels(project: Project): PartLabel[] {
  const rows = projectReport(project).parts;
  const sheetOf = new Map<string, number>();
  project.layout.sheets.forEach((sheet, s) => {
    for (const pl of sheet.placements) sheetOf.set(`${pl.partId}#${pl.index}`, s + 1);
  });
  const out: (PartLabel & { row: number; copy: number })[] = [];
  for (const row of rows) {
    for (let copy = 0; copy < row.qty; copy++) {
      out.push({
        row: row.row,
        copy,
        number: partNumber(row.row, copy + 1),
        partId: row.partId,
        name: row.name,
        finished: row.finished,
        cut: row.cut,
        grain: row.grain,
        band: row.band,
        bandedEdges: row.bandedEdges,
        sheet: sheetOf.get(`${row.partId}#${copy}`) ?? null,
      });
    }
  }
  const sheetKey = (s: number | null) => s ?? Number.MAX_SAFE_INTEGER;
  out.sort((a, b) => sheetKey(a.sheet) - sheetKey(b.sheet) || a.row - b.row || a.copy - b.copy);
  return out.map((l) => ({
    number: l.number,
    partId: l.partId,
    name: l.name,
    finished: l.finished,
    cut: l.cut,
    grain: l.grain,
    band: l.band,
    bandedEdges: l.bandedEdges,
    sheet: l.sheet,
  }));
}
