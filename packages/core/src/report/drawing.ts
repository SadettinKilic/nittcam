/**
 * Layout drawing data of the PDF (T172, spec §6.6 "plaka dizilimi", §2.4 part numbers). Pure: the
 * server renders these numbers to PDF pages; nothing here knows about pages or fonts.
 *
 * Everything is in the sheet frame (mm, Y up, origin at the sheet's bottom-left corner), the same
 * frame as `layout.sheets[].placements`. Geometry is read at cut size (edge-band deduction, §4.8).
 */
import { normalizeGrain } from '../geometry/grain';
import { sampleSegment } from '../geometry/segment';
import type { Polyline } from '../geometry/types';
import { partNumber } from '../cutlist/part-number';
import { partShape, rotatedBoxSize } from '../nesting/fit';
import { toCutSizes } from '../schema/cut-size';
import type { Project } from '../schema/project';
import { innerOperation } from '../schema/operations';
import { sheetSizeOf } from '../schema/sheet-size';
import { placedHoleCentre } from '../toolpath/holes';
import { placedInners, placedLines, placedOutline } from '../toolpath/build';

/** One placed part copy as drawn on a layout page. */
export interface DrawnSheetPart {
  /** "row.copy" (T171): the one numbering rule of layout view, PDF and labels. */
  number: string;
  partId: string;
  /** Copy index from 0. */
  index: number;
  name: string;
  /** Cut size of the part (unrotated), mm; the part's bounding box for a freeform part. */
  width: number;
  height: number;
  /** Footprint (rotated bounding box) in the sheet frame. */
  box: { x: number; y: number; w: number; h: number };
  /** Outer contour, flat [x, y, …] in the sheet frame, arcs sampled. */
  outline: number[];
  /** Inner contours cut through (and engraved or uncut ones) in the same frame. */
  inners: number[][];
  /** Blind contour pockets (T325) in the same frame, with their depth (mm). */
  pockets: { ring: number[]; depth: number }[];
  /**
   * T355: V-grooves (fold lines, T352) in the same frame, flat [x, y, …], arcs sampled; drawn
   * dashed and never as a through cut. Absent when the part has none (drawings unchanged).
   */
  grooves?: { points: number[]; closed: boolean }[];
  /** Holes (incl. template instances): centre and radius. */
  holes: { x: number; y: number; r: number }[];
  /** Sheet-frame grain line angle, degrees [0, 180); null = free grain. */
  grainAngle: number | null;
}

/** One layout sheet as drawn on one PDF page. */
export interface SheetDrawing {
  /** Index of `layout.sheets`. */
  sheet: number;
  width: number;
  height: number;
  /** True when the sheet is cut from a stock offcut (T168). */
  offcut: boolean;
  /** B51: the stock offcut's id (its `offcuts` row), for the PDF's "Artık parçadan" line. */
  offcutId?: string;
  /** Sheet grain angle, degrees [0, 180); null = the sheet has no grain. */
  grain: number | null;
  /** Edge margin of the nesting, mm. */
  margin: number;
  parts: DrawnSheetPart[];
}

/** Segments per arc when an arc is flattened for drawing. */
const ARC_STEPS = 16;

const round3 = (v: number): number => {
  const r = Math.round(v * 1000) / 1000;
  return r === 0 ? 0 : r;
};

/** A closed polyline as a flat [x, y, …] ring, arcs sampled, rounded to 1 µm. */
export function flattenRing(poly: Polyline, steps = ARC_STEPS): number[] {
  const n = poly.vertices.length;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = poly.vertices[i];
    const next = poly.vertices[(i + 1) % n];
    if (!v || !next) continue;
    if (v.bulge === 0) {
      out.push(round3(v.x), round3(v.y));
      continue;
    }
    for (const p of sampleSegment(v, next, v.bulge, steps).slice(0, -1)) {
      out.push(round3(p.x), round3(p.y));
    }
  }
  return out;
}

/** An open polyline as a flat [x, y, …] list, arcs sampled, rounded to 1 µm (T355). */
export function flattenLine(poly: Polyline, steps = ARC_STEPS): number[] {
  const out: number[] = [];
  const vs = poly.vertices;
  for (let i = 0; i < vs.length; i++) {
    const v = vs[i];
    if (!v) continue;
    const next = vs[i + 1];
    if (!next || v.bulge === 0) {
      out.push(round3(v.x), round3(v.y));
      continue;
    }
    for (const p of sampleSegment(v, next, v.bulge, steps).slice(0, -1)) {
      out.push(round3(p.x), round3(p.y));
    }
  }
  return out;
}

/**
 * The drawing of every layout sheet, in layout order; placements of unknown parts are skipped.
 * Parts on a sheet are ordered by part number (cut-list row, then copy) so the page reads the same
 * however the nesting stored them.
 */
export function layoutDrawing(entered: Project): SheetDrawing[] {
  const project = toCutSizes(entered);
  const rows = new Map(project.parts.map((p, i) => [p.id, { part: p, row: i + 1 }]));
  return project.layout.sheets.map((sheet, s): SheetDrawing => {
    const size = sheetSizeOf(project, s);
    const parts: { row: number; part: DrawnSheetPart }[] = [];
    for (const pl of sheet.placements) {
      const hit = rows.get(pl.partId);
      if (!hit) continue;
      const { part } = hit;
      const shape = partShape(part);
      const foot = rotatedBoxSize(shape, pl.rot);
      parts.push({
        row: hit.row,
        part: {
          number: partNumber(hit.row, pl.index + 1),
          partId: part.id,
          index: pl.index,
          name: part.name,
          width: round3(shape.w),
          height: round3(shape.h),
          box: { x: round3(pl.x), y: round3(pl.y), w: round3(foot.w), h: round3(foot.h) },
          outline: flattenRing(placedOutline(part, pl)),
          inners: placedInners(part, pl).flatMap((c, k) => {
            const kind = innerOperation(part, k).kind;
            return kind === 'pocket' || kind === 'vgroove' ? [] : [flattenRing(c)];
          }),
          pockets: placedInners(part, pl).flatMap((c, k) => {
            const op = innerOperation(part, k);
            return op.kind === 'pocket' ? [{ ring: flattenRing(c), depth: op.depth }] : [];
          }),
          ...groovesOf(part, pl),
          holes: part.holes.map((hole) => {
            const c = placedHoleCentre(part, pl, hole);
            return { x: round3(c.x), y: round3(c.y), r: hole.d / 2 };
          }),
          grainAngle:
            part.grain.mode === 'fixed' ? normalizeGrain(part.grain.angle + pl.rot) : null,
        },
      });
    }
    parts.sort((a, b) => a.row - b.row || a.part.index - b.part.index);
    return {
      sheet: s,
      width: size.width,
      height: size.height,
      offcut: sheet.offcutId !== undefined,
      ...(sheet.offcutId !== undefined ? { offcutId: sheet.offcutId } : {}),
      grain: size.grain === null ? null : normalizeGrain(size.grain),
      margin: project.nesting.margin,
      parts: parts.map((p) => p.part),
    };
  });
}

/** T355: the part's V-grooves in the sheet frame, as `{ grooves }` only when there are any. */
function groovesOf(
  part: Project['parts'][number],
  pl: Project['layout']['sheets'][number]['placements'][number],
): Pick<DrawnSheetPart, 'grooves'> {
  const grooves: { points: number[]; closed: boolean }[] = [];
  placedInners(part, pl).forEach((c, k) => {
    if (innerOperation(part, k).kind === 'vgroove') {
      grooves.push({ points: flattenRing(c), closed: true });
    }
  });
  for (const l of placedLines(part, pl)) {
    if (l.op.kind === 'vgroove') grooves.push({ points: flattenLine(l.poly), closed: false });
  }
  return grooves.length > 0 ? { grooves } : {};
}

/** Paper sizes of the PDF (spec §6.6), landscape, in PDF points (1/72 in). */
export const PAPER_SIZES = {
  A4: { width: 841.89, height: 595.28 },
  A3: { width: 1190.55, height: 841.89 },
} as const;
export type PaperSize = keyof typeof PAPER_SIZES;

export const MM_TO_PT = 72 / 25.4;

/**
 * Where a sheet of `width × height` mm goes inside a drawing box (points): the largest uniform
 * scale that fits, centred. `scale` is points per mm.
 */
export function fitSheet(
  sheet: { width: number; height: number },
  box: { x: number; y: number; width: number; height: number },
): { x: number; y: number; scale: number } {
  const scale = Math.min(box.width / sheet.width, box.height / sheet.height);
  return {
    scale,
    x: box.x + (box.width - sheet.width * scale) / 2,
    y: box.y + (box.height - sheet.height * scale) / 2,
  };
}
