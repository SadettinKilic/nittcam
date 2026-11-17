/**
 * Path helpers for the toolpath layer: a closed tool-centre loop as a list of XY segments, start
 * point selection, partial paths (ramps), reversal and conversion to feed moves. Pure.
 */
import { EPS } from '../geometry/constants';
import { arcOf, isArc, segmentLength, sweepToBulge, bulgeToSweep } from '../geometry/segment';
import type { Point, Polyline, Vertex } from '../geometry/types';
import type { FeedMove } from './types';

/** One XY segment from p0 to p1; `bulge` as in the geometry kernel (0 = line). */
export interface PathSeg {
  p0: Point;
  p1: Point;
  bulge: number;
}

/** Segments of a closed polyline (the closing segment included). */
export function loopSegments(poly: Polyline): PathSeg[] {
  const vs = poly.vertices;
  return vs.map((v, i) => {
    const next = vs[(i + 1) % vs.length] as Vertex;
    return { p0: { x: v.x, y: v.y }, p1: { x: next.x, y: next.y }, bulge: v.bulge };
  });
}

export function segLength(s: PathSeg): number {
  return segmentLength(s.p0, s.p1, s.bulge);
}

export function pathLength(segs: readonly PathSeg[]): number {
  return segs.reduce((sum, s) => sum + segLength(s), 0);
}

/**
 * The same closed loop, starting at the midpoint of its longest straight segment (deterministic:
 * the first one wins a tie). A loop without straight segments (a circle) keeps its start vertex.
 * The start point is where the lead-in joins the contour: on a straight edge it is well away from
 * corners.
 */
export function startAtLongestLine(poly: Polyline): Polyline {
  const vs = poly.vertices;
  const n = vs.length;
  let best = -1;
  let bestLen = 0;
  vs.forEach((v, i) => {
    const next = vs[(i + 1) % n] as Vertex;
    if (isArc(v, next, v.bulge)) return;
    const len = Math.hypot(next.x - v.x, next.y - v.y);
    if (len > bestLen + EPS) {
      best = i;
      bestLen = len;
    }
  });
  if (best < 0) return { closed: true, vertices: vs.map((v) => ({ ...v })) };
  const a = vs[best] as Vertex;
  const b = vs[(best + 1) % n] as Vertex;
  const mid: Vertex = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, bulge: 0 };
  const out: Vertex[] = [mid];
  for (let k = 1; k <= n; k++) {
    const v = vs[(best + k) % n] as Vertex;
    // the last one is `a`, whose segment now ends at `mid`: still a line
    out.push(k === n ? { x: v.x, y: v.y, bulge: 0 } : { ...v });
  }
  return { closed: true, vertices: out };
}

/** Unit tangent of the direction of travel at the start (`at = 0`) or end (`at = 1`) of a segment. */
export function tangent(s: PathSeg, at: 0 | 1): Point {
  const arc = arcOf(s.p0, s.p1, s.bulge);
  if (!arc) {
    const len = Math.hypot(s.p1.x - s.p0.x, s.p1.y - s.p0.y);
    return { x: (s.p1.x - s.p0.x) / len, y: (s.p1.y - s.p0.y) / len };
  }
  const p = at === 0 ? s.p0 : s.p1;
  const ux = (p.x - arc.center.x) / arc.radius;
  const uy = (p.y - arc.center.y) / arc.radius;
  // CCW travel: tangent = radius vector turned +90°; CW: −90°.
  return arc.sweep > 0 ? { x: -uy, y: ux } : { x: uy, y: -ux };
}

/** Point at fraction f (0..1) of the segment's length, and the two halves' bulges. */
function splitSeg(s: PathSeg, f: number): { point: Point; first: PathSeg; second: PathSeg } {
  const arc = arcOf(s.p0, s.p1, s.bulge);
  if (!arc) {
    const point = { x: s.p0.x + (s.p1.x - s.p0.x) * f, y: s.p0.y + (s.p1.y - s.p0.y) * f };
    return {
      point,
      first: { p0: s.p0, p1: point, bulge: 0 },
      second: { p0: point, p1: s.p1, bulge: 0 },
    };
  }
  const sweep = bulgeToSweep(s.bulge);
  const ang = arc.startAngle + sweep * f;
  const point = {
    x: arc.center.x + arc.radius * Math.cos(ang),
    y: arc.center.y + arc.radius * Math.sin(ang),
  };
  return {
    point,
    first: { p0: s.p0, p1: point, bulge: sweepToBulge(sweep * f) },
    second: { p0: point, p1: s.p1, bulge: sweepToBulge(sweep * (1 - f)) },
  };
}

/** The first `len` mm of a path (the whole path when `len` ≥ its length). */
export function subpath(segs: readonly PathSeg[], len: number): PathSeg[] {
  const out: PathSeg[] = [];
  let left = len;
  for (const s of segs) {
    const l = segLength(s);
    if (l <= left + EPS / 100) {
      out.push(s);
      left -= l;
      if (left <= EPS / 100) break;
      continue;
    }
    out.push(splitSeg(s, left / l).first);
    break;
  }
  return out;
}

/** The path traversed backwards; arcs keep their shape (bulge negated). */
export function reversePath(segs: readonly PathSeg[]): PathSeg[] {
  return segs
    .slice()
    .reverse()
    .map((s) => ({ p0: s.p1, p1: s.p0, bulge: 0 - s.bulge }));
}

/**
 * Feed moves along a path. Z goes linearly with the path length from `z0` (at the start) to `z1`
 * (at the end), so a constant `z0 = z1` gives a flat pass and `z1 < z0` a ramp.
 */
export function pathMoves(
  segs: readonly PathSeg[],
  z0: number,
  z1: number,
  feed: number,
): FeedMove[] {
  const total = pathLength(segs);
  let walked = 0;
  return segs.map((s, i) => {
    walked += segLength(s);
    const z = i === segs.length - 1 || total === 0 ? z1 : z0 + ((z1 - z0) * walked) / total;
    const arc = arcOf(s.p0, s.p1, s.bulge);
    if (!arc) return { kind: 'linear', x: s.p1.x, y: s.p1.y, z, feed };
    return {
      kind: 'arc',
      x: s.p1.x,
      y: s.p1.y,
      z,
      cx: arc.center.x,
      cy: arc.center.y,
      direction: arc.sweep > 0 ? 'ccw' : 'cw',
      bulge: s.bulge,
      feed,
    };
  });
}

/**
 * The part of a path between arc lengths `from` and `to` (0 ≤ from ≤ to ≤ length). Segments that
 * fall inside are kept as they are; the two cut segments are split exactly (lines and arcs).
 */
export function slicePath(segs: readonly PathSeg[], from: number, to: number): PathSeg[] {
  const out: PathSeg[] = [];
  let s0 = 0;
  for (const s of segs) {
    const l = segLength(s);
    const s1 = s0 + l;
    const a = Math.max(from, s0);
    const b = Math.min(to, s1);
    if (b - a > EPS / 100 && l > 0) {
      let piece = s;
      // cut the end first (fractions refer to the whole segment), then the start
      if (b < s1 - EPS / 100) piece = splitSeg(piece, (b - s0) / l).first;
      if (a > s0 + EPS / 100) {
        const pl = segLength(piece);
        piece = splitSeg(piece, (a - s0) / pl).second;
      }
      out.push(piece);
    }
    s0 = s1;
    if (s0 >= to) break;
  }
  return out;
}
