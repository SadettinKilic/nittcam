/**
 * Arc geometry of the G-code reader (T018, D-026): centre from I/J or R, radius consistency,
 * swept angle and sampling into segments. Plane G17 only.
 */
import { EPS } from '../geometry/constants';
import type { GcodeArc, GcodeMove, GcodePoint } from './types';

/** Default allowed difference between start and end radius of an I/J arc, mm (10 × EPS). */
export const ARC_RADIUS_TOLERANCE = 10 * EPS;

const TAU = 2 * Math.PI;

export type ArcResult =
  | { ok: true; arc: GcodeArc }
  | { ok: false; code: 'ARC_INVALID' | 'ARC_RADIUS_MISMATCH'; message: string };

/** Swept angle in (0, 2π] from start to end around the centre; `full` = start equals end. */
function sweepOf(
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  cx: number,
  cy: number,
  direction: 'cw' | 'ccw',
  full: boolean,
): number {
  if (full) return TAU;
  const a0 = Math.atan2(sy - cy, sx - cx);
  const a1 = Math.atan2(ey - cy, ex - cx);
  let sw = direction === 'ccw' ? a1 - a0 : a0 - a1;
  while (sw <= 0) sw += TAU;
  while (sw > TAU) sw -= TAU;
  return sw;
}

/** Arc from an absolute centre (I/J already resolved to the program frame). */
export function arcFromCentre(
  start: GcodePoint,
  end: GcodePoint,
  cx: number,
  cy: number,
  direction: 'cw' | 'ccw',
  tolerance: number,
): ArcResult {
  const r0 = Math.hypot(start.x - cx, start.y - cy);
  const r1 = Math.hypot(end.x - cx, end.y - cy);
  if (r0 < EPS) {
    return { ok: false, code: 'ARC_INVALID', message: 'Arc radius is zero (centre on the start)' };
  }
  if (Math.abs(r0 - r1) > tolerance) {
    return {
      ok: false,
      code: 'ARC_RADIUS_MISMATCH',
      message: `Arc start radius ${r0.toFixed(4)} and end radius ${r1.toFixed(4)} differ by more than ${tolerance} mm`,
    };
  }
  const full = Math.hypot(end.x - start.x, end.y - start.y) < EPS;
  return {
    ok: true,
    arc: {
      cx,
      cy,
      radius: r0,
      sweep: sweepOf(start.x, start.y, end.x, end.y, cx, cy, direction, full),
      direction,
      form: 'ij',
    },
  };
}

/**
 * Arc from a signed radius (R form). R > 0: the arc of at most 180°; R < 0: the arc of more than
 * 180°. A full circle cannot be written with R. A chord longer than 2|R| by more than the
 * tolerance is an error; within it the arc is a half circle.
 */
export function arcFromRadius(
  start: GcodePoint,
  end: GcodePoint,
  r: number,
  direction: 'cw' | 'ccw',
  tolerance: number,
): ArcResult {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const d = Math.hypot(dx, dy);
  const ra = Math.abs(r);
  if (ra < EPS) return { ok: false, code: 'ARC_INVALID', message: 'Arc radius R is zero' };
  if (d < EPS) {
    return {
      ok: false,
      code: 'ARC_INVALID',
      message: 'A full circle (start = end) cannot be written with R; use I/J',
    };
  }
  if (d > 2 * ra + tolerance) {
    return {
      ok: false,
      code: 'ARC_INVALID',
      message: `Arc R ${ra.toFixed(4)} is too small for the chord ${d.toFixed(4)}`,
    };
  }
  const h2 = ra * ra - (d / 2) * (d / 2);
  const h = h2 > 0 ? Math.sqrt(h2) : 0;
  // Centre to the right of the chord for (cw, R > 0) and (ccw, R < 0), to the left otherwise.
  const right = (direction === 'cw') === r > 0;
  const s = right ? 1 : -1;
  const cx = (start.x + end.x) / 2 + (s * h * dy) / d;
  const cy = (start.y + end.y) / 2 - (s * h * dx) / d;
  return {
    ok: true,
    arc: {
      cx,
      cy,
      radius: ra,
      sweep: sweepOf(start.x, start.y, end.x, end.y, cx, cy, direction, false),
      direction,
      form: 'r',
    },
  };
}

/**
 * Points along a move, without its start and with its end. A line gives `[to]`; an arc is split
 * into equal steps whose chord deviates at most `chordTolerance` mm from the arc (Z linear, so a
 * helix stays exact). For consumers that draw or measure the read path (simulation, T019, T020).
 */
export function sampleMove(move: GcodeMove, chordTolerance = 0.01): GcodePoint[] {
  const arc = move.arc;
  if (!arc) return [{ ...move.to }];
  const tol = chordTolerance > 0 ? chordTolerance : 0.01;
  const maxStep = tol >= arc.radius ? Math.PI / 2 : 2 * Math.acos(1 - tol / arc.radius);
  const n = Math.min(100_000, Math.max(1, Math.ceil(arc.sweep / Math.min(maxStep, Math.PI / 2))));
  const a0 = Math.atan2(move.from.y - arc.cy, move.from.x - arc.cx);
  const sign = arc.direction === 'ccw' ? 1 : -1;
  const pts: GcodePoint[] = [];
  for (let k = 1; k < n; k++) {
    const t = k / n;
    const a = a0 + sign * arc.sweep * t;
    pts.push({
      x: arc.cx + arc.radius * Math.cos(a),
      y: arc.cy + arc.radius * Math.sin(a),
      z: move.from.z + (move.to.z - move.from.z) * t,
    });
  }
  pts.push({ ...move.to });
  return pts;
}

/** Length of a move (helical length for an arc that changes Z). */
export function moveLength(move: GcodeMove): number {
  const arc = move.arc;
  if (!arc) {
    return Math.hypot(move.to.x - move.from.x, move.to.y - move.from.y, move.to.z - move.from.z);
  }
  return Math.hypot(arc.radius * arc.sweep, move.to.z - move.from.z);
}
