import { allowedRotations, defaultSheet, rotationPolicyOf, type Project } from '@nittcam/core';

/**
 * Layout editing helpers (T170, spec §6.2): turning a part through its allowed angles and
 * snapping a dragged part to its neighbours. Pure, so the view and the tests share them.
 */

/**
 * The next of the part's `allowedRotations` after `rot` (cyclic), the same list `lockPlacement`
 * checks (D-034), so the UI can never turn a fixed-grain part off its grain. Null when the part
 * has a single allowed angle (or is unknown): nothing to turn to.
 */
export function nextRotation(project: Project, partId: string, rot: number): number | null {
  const part = project.parts.find((p) => p.id === partId);
  if (!part) return null;
  const angles = allowedRotations(part, defaultSheet(project), rotationPolicyOf(project.nesting));
  if (angles.length < 2) return null;
  const after = angles.find((a) => a > rot + 1e-6);
  return after ?? angles[0] ?? null;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SnapOptions {
  /** Distance kept to a neighbour: tool diameter + gap (the drop check's spacing), mm. */
  spacing: number;
  /** Pull distance, mm (a few screen pixels at the current zoom). */
  tolerance: number;
}

/** Whether [a0, a1] and [b0, b1] overlap after widening b by `pad` on both sides. */
function overlaps(a0: number, a1: number, b0: number, b1: number, pad: number): boolean {
  return a0 < b1 + pad && a1 > b0 - pad;
}

function closest(value: number, candidates: readonly number[], tolerance: number): number {
  let best = value;
  let dist = tolerance;
  for (const c of candidates) {
    const d = Math.abs(c - value);
    if (d <= dist) {
      best = c;
      dist = d;
    }
  }
  return best;
}

/**
 * Snaps the bottom-left corner (x, y) of a dragged box of size w × h, each axis on its own:
 * - next to a neighbour at exactly `spacing` (left/right of it when they share rows, below/above
 *   when they share columns), so a snapped drop passes the spacing check;
 * The closest candidate within `tolerance` wins; none = the position is kept.
 */
export function snapToNeighbours(
  moving: { w: number; h: number },
  x: number,
  y: number,
  others: readonly Box[],
  { spacing, tolerance }: SnapOptions,
): { x: number; y: number } {
  const { w, h } = moving;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const o of others) {
    if (overlaps(y, y + h, o.y, o.y + o.h, tolerance)) {
      xs.push(o.x + o.w + spacing, o.x - spacing - w);
    }
    if (overlaps(x, x + w, o.x, o.x + o.w, tolerance)) {
      ys.push(o.y + o.h + spacing, o.y - spacing - h);
    }
  }
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return { x: round(closest(x, xs, tolerance)), y: round(closest(y, ys, tolerance)) };
}
