/**
 * Arc helpers of the post processor (spec §6.4 arcs; D-025). Sheet frame, pure.
 */
import type { ArcMove } from '../toolpath';
import type { Point3 } from './frame';

/** Largest radius mismatch between start and end allowed for an arc, mm. */
export const ARC_RADIUS_TOL = 0.002;

export interface ArcGeometry {
  cx: number;
  cy: number;
  r: number;
  /** Start angle, radians. */
  a0: number;
  /** Signed sweep, radians (+ = CCW). */
  sweep: number;
}

/**
 * Checked geometry of an arc that starts at `start`. Null with a reason when the arc is
 * inconsistent (radius mismatch, bulge sign against `direction`, sweep mismatch, zero radius).
 */
export function arcGeometry(
  start: Point3,
  arc: ArcMove,
): { ok: true; arc: ArcGeometry } | { ok: false; reason: string } {
  const vals = [start.x, start.y, arc.x, arc.y, arc.cx, arc.cy, arc.bulge];
  if (!vals.every(Number.isFinite)) return { ok: false, reason: 'non-finite arc value' };
  const r0 = Math.hypot(start.x - arc.cx, start.y - arc.cy);
  const r1 = Math.hypot(arc.x - arc.cx, arc.y - arc.cy);
  if (r0 < 1e-6) return { ok: false, reason: 'zero radius' };
  if (Math.abs(r0 - r1) > ARC_RADIUS_TOL) {
    return { ok: false, reason: `radius mismatch ${r0.toFixed(4)} / ${r1.toFixed(4)}` };
  }
  if (arc.bulge === 0) return { ok: false, reason: 'zero bulge' };
  if (arc.bulge > 0 !== (arc.direction === 'ccw')) {
    return { ok: false, reason: 'bulge sign does not match the direction' };
  }
  const sweep = 4 * Math.atan(arc.bulge);
  const a0 = Math.atan2(start.y - arc.cy, start.x - arc.cx);
  // The end point must be where the sweep leads (within the radius tolerance).
  const ex = arc.cx + r0 * Math.cos(a0 + sweep);
  const ey = arc.cy + r0 * Math.sin(a0 + sweep);
  if (Math.hypot(ex - arc.x, ey - arc.y) > ARC_RADIUS_TOL * 2) {
    return { ok: false, reason: 'end point does not match centre and bulge' };
  }
  return { ok: true, arc: { cx: arc.cx, cy: arc.cy, r: r0, a0, sweep } };
}

/**
 * Splits an arc into `n` equal pieces; each piece is `{ x, y, z }` at its end (Z linear in the
 * angle, i.e. helical). The last piece ends exactly at `end`.
 */
export function splitArc(g: ArcGeometry, start: Point3, end: Point3, n: number): Point3[] {
  const out: Point3[] = [];
  for (let i = 1; i <= n; i++) {
    if (i === n) {
      out.push({ x: end.x, y: end.y, z: end.z });
      break;
    }
    const t = i / n;
    const a = g.a0 + g.sweep * t;
    out.push({
      x: g.cx + g.r * Math.cos(a),
      y: g.cy + g.r * Math.sin(a),
      z: start.z + (end.z - start.z) * t,
    });
  }
  return out;
}

/** Pieces needed so no block sweeps more than `maxSweepDeg` (and a full circle is split). */
export function arcPieces(g: ArcGeometry, maxSweepDeg: number, fullCircle: boolean): number {
  const abs = Math.abs(g.sweep);
  let n = Math.max(1, Math.ceil(abs / ((maxSweepDeg * Math.PI) / 180) - 1e-9));
  if (!fullCircle && abs > Math.PI * 2 - 1e-6) n = Math.max(n, 2);
  return n;
}

/**
 * Line segments needed so the chord sagitta r·(1 − cos(θ/2)) stays within `tol` (at most a
 * quarter circle per segment).
 */
export function chordSegments(g: ArcGeometry, tol: number): number {
  const maxStep = tol >= g.r ? Math.PI / 2 : Math.min(Math.PI / 2, 2 * Math.acos(1 - tol / g.r));
  return Math.max(1, Math.ceil(Math.abs(g.sweep) / maxStep - 1e-9));
}
