/**
 * Shared size rules of nesting and validation (D-019). Pure.
 */
import { bbox, contour } from '../geometry';
import { EPS } from '../geometry/constants';
import { isQuarterTurn, rotate } from '../geometry/transform';
import type { Polyline } from '../geometry/types';
import { deriveOutline, type Part } from '../schema';

/** Width/height of a part's bounding box at rotation 0 (arc-aware for freeform outlines). */
export function partBoxSize(part: Part): { w: number; h: number } {
  if (part.kind === 'rect') return { w: part.params.w, h: part.params.h };
  const box = bbox(contour(part.outline));
  return { w: box.maxX - box.minX, h: box.maxY - box.minY };
}

/**
 * A part as footprint code sees it: its bounding box at rotation 0 and, for rotations that are
 * not quarter turns, its outline in the local frame.
 */
export interface PartShape {
  w: number;
  h: number;
  /** Local outline; without it a non-axis rotation turns the w × h rectangle. */
  outline?: Polyline | undefined;
}

/** `PartShape` of a part: bbox size plus its outline (arc-aware, D-034). */
export function partShape(part: Part): PartShape {
  return { ...partBoxSize(part), outline: contour(deriveOutline(part)) };
}

/**
 * Size of the axis-aligned bounding box of a part rotated by `rot` degrees CCW (D-034). Quarter
 * turns swap or keep w × h exactly (unchanged from before); any other angle takes the arc-aware
 * bbox of the rotated outline, the conservative footprint the rectangle placer uses until
 * true-shape nesting (T165–T167).
 */
export function rotatedBoxSize(shape: PartShape, rot: number): { w: number; h: number } {
  const r = ((rot % 360) + 360) % 360;
  if (isQuarterTurn(r))
    return r === 90 || r === 270 ? { w: shape.h, h: shape.w } : { w: shape.w, h: shape.h };
  const outline: Polyline = shape.outline ?? {
    closed: true,
    vertices: [
      { x: 0, y: 0, bulge: 0 },
      { x: shape.w, y: 0, bulge: 0 },
      { x: shape.w, y: shape.h, bulge: 0 },
      { x: 0, y: shape.h, bulge: 0 },
    ],
  };
  const box = bbox(rotate(outline, r));
  return { w: box.maxX - box.minX, h: box.maxY - box.minY };
}

/** One distinct footprint a part can take: rotation and its rotated bbox size. */
export interface RotationOption {
  rot: number;
  w: number;
  h: number;
}

/**
 * The distinct footprints of a part over the given rotations, in the given (ascending) order:
 * a rotation whose bbox equals an earlier one (180° of 0°, a square's 90°) is dropped, so the
 * placer tries each footprint once and keeps the lowest rotation (D-034).
 */
export function rotationOptions(shape: PartShape, rotations: readonly number[]): RotationOption[] {
  const out: RotationOption[] = [];
  for (const rot of rotations) {
    const size = rotatedBoxSize(shape, rot);
    const same = out.some((o) => Math.abs(o.w - size.w) <= 1e-9 && Math.abs(o.h - size.h) <= 1e-9);
    if (!same) out.push({ rot, ...size });
  }
  return out;
}

/** Whether any of the footprints fits an empty usable area (PART_LARGER_THAN_SHEET, TOO_LARGE). */
export function fitsUsableAny(
  options: readonly RotationOption[],
  usable: { width: number; height: number },
): boolean {
  return options.some((o) => fitsWithin(o.w, usable.width) && fitsWithin(o.h, usable.height));
}

/** The usable sheet area: the sheet shrunk by `margin` on every side (may be ≤ 0). */
export function usableSize(
  sheet: { width: number; height: number },
  margin: number,
): { width: number; height: number } {
  return { width: sheet.width - 2 * margin, height: sheet.height - 2 * margin };
}

/** Fits within EPS: a bbox computed from arcs may overshoot an exact fit by rounding. */
export function fitsWithin(size: number, room: number): boolean {
  return size <= room + EPS;
}

/**
 * Whether a w × h part fits an empty usable area in an allowed orientation: as is, or turned 90°
 * when it is not grain-locked (spec §6.2).
 */
export function fitsUsable(
  w: number,
  h: number,
  grainLock: boolean,
  usable: { width: number; height: number },
): boolean {
  const asIs = fitsWithin(w, usable.width) && fitsWithin(h, usable.height);
  const turned = !grainLock && fitsWithin(h, usable.width) && fitsWithin(w, usable.height);
  return asIs || turned;
}
