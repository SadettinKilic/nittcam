/**
 * Curve flattening for DXF import (T144, spec §4.6 "SPLINE ve ELLIPSE toleransla çizgi/yaya
 * çevrilir"): NURBS evaluation (de Boor), a fit-point spline fallback and adaptive subdivision so
 * that every point of the true curve lies within CURVE_TOL of the resulting line segments.
 * Pure code: no clock, randomness or I/O.
 */
import { CURVE_TOL } from '../geometry/constants';
import type { Point } from '../geometry/types';

/** A parametric curve t → point (mm). */
export type CurveFn = (t: number) => Point;

/** Hard cap on the points one curve may produce (a corrupt file must not hang the import). */
export const MAX_CURVE_POINTS = 20_000;

/** Deepest subdivision of one starting interval (2^24 parts: far below any useful tolerance). */
const MAX_DEPTH = 24;

/** Distance from p to the segment a–b. */
export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Points of `fn` on [t0, t1] (both ends included) whose chords stay within `tol` of the curve.
 * `breaks` are parameters where the curve may bend sharply (knots, quadrants): they always become
 * vertices. Each starting interval is split into `minSteps` parts first so that a closed curve
 * (start = end) is never mistaken for a straight chord.
 */
export function flattenCurve(
  fn: CurveFn,
  t0: number,
  t1: number,
  tol: number = CURVE_TOL,
  breaks: readonly number[] = [],
  minSteps = 4,
): Point[] {
  const cuts = [t0, ...breaks.filter((b) => b > t0 && b < t1), t1];
  const out: Point[] = [fn(t0)];
  // Test against half the tolerance: the interior probes bound the deviation between them.
  const limit = tol / 2;
  const refine = (a: number, pa: Point, b: number, pb: Point, depth: number): void => {
    if (out.length >= MAX_CURVE_POINTS) return;
    let flat = depth >= MAX_DEPTH;
    if (!flat) {
      flat = true;
      for (let k = 1; k <= 3; k++) {
        if (distToSegment(fn(a + ((b - a) * k) / 4), pa, pb) > limit) {
          flat = false;
          break;
        }
      }
    }
    if (flat) {
      out.push(pb);
      return;
    }
    const m = (a + b) / 2;
    const pm = fn(m);
    refine(a, pa, m, pm, depth + 1);
    refine(m, pm, b, pb, depth + 1);
  };
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i] as number;
    const b = cuts[i + 1] as number;
    let prevT = a;
    let prevP = fn(a);
    for (let s = 1; s <= minSteps; s++) {
      const t = s === minSteps ? b : a + ((b - a) * s) / minSteps;
      const p = fn(t);
      refine(prevT, prevP, t, p, 0);
      prevT = t;
      prevP = p;
    }
  }
  return out;
}

/** A NURBS curve as stored in a DXF SPLINE (control points, knots, optional weights). */
export interface Nurbs {
  degree: number;
  controls: readonly Point[];
  knots: readonly number[];
  /** One weight per control point; absent = all 1 (non-rational). */
  weights?: readonly number[];
}

/** True when the knot vector fits the control points (n + p + 1 knots, non-decreasing). */
export function validNurbs(c: Nurbs): boolean {
  const p = c.degree;
  if (!Number.isInteger(p) || p < 1 || c.controls.length < p + 1) return false;
  if (c.knots.length !== c.controls.length + p + 1) return false;
  for (let i = 1; i < c.knots.length; i++) {
    if ((c.knots[i] as number) < (c.knots[i - 1] as number)) return false;
  }
  if (c.weights && (c.weights.length !== c.controls.length || c.weights.some((w) => !(w > 0)))) {
    return false;
  }
  return (c.knots[p] as number) < (c.knots[c.controls.length] as number);
}

/** Clamped uniform knots for `n` control points of degree `p` (fallback for broken knot data). */
export function clampedKnots(n: number, p: number): number[] {
  const knots: number[] = [];
  const inner = n - p;
  for (let i = 0; i <= p; i++) knots.push(0);
  for (let i = 1; i < inner; i++) knots.push(i / inner);
  for (let i = 0; i <= p; i++) knots.push(1);
  return knots;
}

/** Parameter range [knots[p], knots[n]] of a valid NURBS. */
export function nurbsDomain(c: Nurbs): [number, number] {
  return [c.knots[c.degree] as number, c.knots[c.controls.length] as number];
}

/** Distinct interior knots (the places where the curve may bend sharply). */
export function nurbsBreaks(c: Nurbs): number[] {
  const [t0, t1] = nurbsDomain(c);
  const out: number[] = [];
  for (const k of c.knots) {
    if (k > t0 && k < t1 && out[out.length - 1] !== k) out.push(k);
  }
  return out;
}

/** Point of a valid NURBS at parameter t (de Boor on homogeneous coordinates). */
export function nurbsPoint(c: Nurbs, t: number): Point {
  const p = c.degree;
  const n = c.controls.length;
  const U = c.knots;
  // Knot span k with U[k] <= t < U[k+1], clamped into [p, n − 1].
  let k = p;
  while (k < n - 1 && t >= (U[k + 1] as number)) k++;
  const d: { x: number; y: number; w: number }[] = [];
  for (let j = 0; j <= p; j++) {
    const cp = c.controls[k - p + j] as Point;
    const w = c.weights ? (c.weights[k - p + j] as number) : 1;
    d.push({ x: cp.x * w, y: cp.y * w, w });
  }
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const lo = U[j + k - p] as number;
      const hi = U[j + 1 + k - r] as number;
      const alpha = hi === lo ? 0 : (t - lo) / (hi - lo);
      const a = d[j - 1] as { x: number; y: number; w: number };
      const b = d[j] as { x: number; y: number; w: number };
      d[j] = {
        x: (1 - alpha) * a.x + alpha * b.x,
        y: (1 - alpha) * a.y + alpha * b.y,
        w: (1 - alpha) * a.w + alpha * b.w,
      };
    }
  }
  const r = d[p] as { x: number; y: number; w: number };
  return { x: r.x / r.w, y: r.y / r.w };
}

/**
 * A curve through fit points (a SPLINE stored without control points): uniform Catmull-Rom.
 * It passes through every fit point; between them it is close to, but not identical with, the
 * CAD program's own interpolation, so the import report marks it.
 */
export function fitPointCurve(
  points: readonly Point[],
  closed: boolean,
): {
  fn: CurveFn;
  t1: number;
} {
  const pts = closed ? [...points, points[0] as Point] : [...points];
  const m = pts.length;
  const at = (i: number): Point => {
    if (closed) {
      const n = m - 1;
      return pts[((i % n) + n) % n] as Point;
    }
    return pts[Math.max(0, Math.min(m - 1, i))] as Point;
  };
  const fn: CurveFn = (t) => {
    const i = Math.min(Math.floor(t), m - 2);
    const u = t - i;
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const u2 = u * u;
    const u3 = u2 * u;
    const f = (a: number, b: number, c: number, d: number) =>
      0.5 *
      (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u2 + (-a + 3 * b - 3 * c + d) * u3);
    return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) };
  };
  return { fn, t1: m - 1 };
}
