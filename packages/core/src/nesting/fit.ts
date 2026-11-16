/**
 * Shared size rules of nesting and validation (D-019). Pure.
 */
import { bbox, contour } from '../geometry';
import { EPS } from '../geometry/constants';
import type { Part } from '../schema';

/** Width/height of a part's bounding box at rotation 0 (arc-aware for freeform outlines). */
export function partBoxSize(part: Part): { w: number; h: number } {
  if (part.kind === 'rect') return { w: part.params.w, h: part.params.h };
  const box = bbox(contour(part.outline));
  return { w: box.maxX - box.minX, h: box.maxY - box.minY };
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
