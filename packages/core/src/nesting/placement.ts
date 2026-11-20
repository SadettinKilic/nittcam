/**
 * Where a placement may stand (spec §6.2 "Elle müdahale", D-019, D-020). The same check backs the
 * `LOCKED_PLACEMENT_INVALID` rule and the drag-and-drop of the layout view, so the UI refuses
 * exactly the drops the rule would flag. Pure.
 */
import { EPS } from '../geometry/constants';
import { sheetSizeOf, type Placement, type Project } from '../schema';
import { partShape, type PartShape } from './fit';
import { placementRect } from './nest';
import {
  footprintContours,
  footprintsOverlap,
  moveFootprint,
  rectOutline,
  shapeOption,
} from './shape';
import type { Rect } from './types';

/** A part copy on a sheet. */
export interface CopyRef {
  partId: string;
  index: number;
}

export interface PlacementCheck {
  /** Some part of the footprint lies outside the raw sheet. */
  outsideSheet: boolean;
  /** Inside the sheet but in the margin band (closer than `nesting.margin` to an edge). */
  inMargin: boolean;
  /**
   * Other placements on the same sheet that are closer than the required spacing
   * (`toolDiameter + gap`) or overlap, in sheet order.
   */
  conflicts: CopyRef[];
}

export interface PlacementCheckOptions {
  /** Cutting tool diameter, mm (from the machine profile). */
  toolDiameter: number;
  /**
   * The layout comes from the true-shape engine (T165): bbox conflicts are re-checked on the real
   * footprints. Absent = the rectangle rule (bbox clearance), unchanged.
   */
  trueShape?: boolean | undefined;
}

/** True when the check found nothing wrong. */
export function placementIsValid(check: PlacementCheck): boolean {
  return !check.outsideSheet && !check.inMargin && check.conflicts.length === 0;
}

/**
 * Distance between two rectangles along the axis where they are farthest apart (Chebyshev
 * clearance): negative when they overlap, 0 when they touch.
 */
export function rectClearance(a: Rect, b: Rect): number {
  const dx = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w));
  const dy = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h));
  return Math.max(dx, dy);
}

/** Part shapes by id: bounding-box size at rotation 0 plus the outline for any other angle. */
export function partSizes(project: Project): Map<string, PartShape> {
  return new Map(project.parts.map((p) => [p.id, partShape(p)]));
}

/**
 * Checks `candidate` as if it stood on sheet `sheetIndex`: inside the sheet, outside the margin
 * band, and at least `toolDiameter + gap` from every other placement on that sheet (the same
 * spacing the placer keeps, D-019). The candidate's own copy (same part id and index) is ignored,
 * so a moved placement is checked against the others only. Fits are accepted within EPS.
 * An unknown part id yields no footprint and is reported as outside the sheet.
 */
export function checkPlacement(
  project: Project,
  sheetIndex: number,
  candidate: Placement,
  options: PlacementCheckOptions,
  sizes: ReadonlyMap<string, PartShape> = partSizes(project),
): PlacementCheck {
  const r = placementRect(candidate, sizes);
  if (!r) return { outsideSheet: true, inMargin: false, conflicts: [] };
  const { width, height } = sheetSizeOf(project, sheetIndex);
  const { margin, gap } = project.nesting;
  const outsideSheet =
    r.x < -EPS || r.y < -EPS || r.x + r.w > width + EPS || r.y + r.h > height + EPS;
  const inMargin =
    !outsideSheet &&
    (r.x < margin - EPS ||
      r.y < margin - EPS ||
      r.x + r.w > width - margin + EPS ||
      r.y + r.h > height - margin + EPS);
  const spacing = options.toolDiameter + gap;
  const conflicts: CopyRef[] = [];
  for (const other of project.layout.sheets[sheetIndex]?.placements ?? []) {
    if (other.partId === candidate.partId && other.index === candidate.index) continue;
    const o = placementRect(other, sizes);
    if (!o) continue;
    if (
      rectClearance(r, o) < spacing - EPS &&
      (!options.trueShape || shapesConflict(candidate, other, sizes, spacing))
    ) {
      conflicts.push({ partId: other.partId, index: other.index });
    }
  }
  return { outsideSheet, inMargin, conflicts };
}

/**
 * Whether two placements whose bounding boxes are too close really conflict (T165): their true
 * footprints (outline + spacing/2, round tool) overlap. Bboxes are only a pre-filter, so a
 * true-shape layout (interlocked shapes, diagonal neighbours) is not reported. Without an outline
 * the w × h rectangle is the shape.
 */
function shapesConflict(
  a: Placement,
  b: Placement,
  sizes: ReadonlyMap<string, PartShape>,
  spacing: number,
): boolean {
  const fp = (pl: Placement) => {
    const shape = sizes.get(pl.partId) as PartShape;
    const outline = shape.outline ?? rectOutline(shape.w, shape.h);
    const option = shapeOption(outline, footprintContours(outline, [], spacing / 2), pl.rot);
    return moveFootprint(option.fp, pl.x, pl.y);
  };
  return footprintsOverlap(fp(a), fp(b));
}

/** Sheet index and position in the sheet's list of a part copy; null when it is not placed. */
export function findPlacement(
  project: Project,
  ref: CopyRef,
): { sheet: number; position: number; placement: Placement } | null {
  for (const [sheet, sh] of project.layout.sheets.entries()) {
    const position = sh.placements.findIndex(
      (p) => p.partId === ref.partId && p.index === ref.index,
    );
    const placement = sh.placements[position];
    if (placement) return { sheet, position, placement };
  }
  return null;
}
