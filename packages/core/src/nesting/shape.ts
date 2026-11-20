/**
 * True-shape footprints and collision (T165, spec §6.2 v3, D-034). Pure and deterministic.
 *
 * A part's footprint is its outer contour offset outward by `s = toolRadius + gap/2` (our own
 * `offset`, arcs kept), minus its inner contours offset inward by `s` (the hole zones, where other
 * footprints may sit, T166). Two copies keep `toolDiameter + gap` apart exactly when their
 * footprints do not overlap. Arcs are discretised for the collision test only (the cutting
 * geometry stays exact) and always to the safe side: the polygon covers the occupied region
 * (outer arcs circumscribed, concave arcs by chords; hole zones the reverse), so a polygon test
 * that passes never hides a true overlap.
 */
import { offset } from '../geometry/offset';
import { bbox, normalize } from '../geometry/polyline';
import { arcOf } from '../geometry/segment';
import { rotate } from '../geometry/transform';
import type { Point, Polyline } from '../geometry/types';

/** Maximum distance (mm) between a discretised arc and the true arc (to the safe side). */
export const NEST_CURVE_TOL = 0.05;
/** At most this many pieces per arc (big arcs at NEST_CURVE_TOL would cost too much). */
const MAX_ARC_PIECES = 48;
/** Cross products (mm²) at or below this are treated as collinear: touching is not overlapping. */
const CROSS_EPS = 1e-7;

/** A closed polygon ring as flat coordinates plus its bounding box. Occupied side = left. */
export interface Ring {
  xs: Float64Array;
  ys: Float64Array;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * A footprint in some frame: the outer ring (CCW), hole-zone rings (CW) and one point that lies
 * strictly inside the occupied region (a vertex of the part outline, `s` inside the outer ring).
 */
export interface Footprint {
  outer: Ring;
  holes: Ring[];
  anchor: Point;
}

/** A footprint at one rotation in the placement frame: (0, 0) = the placement's (x, y). */
export interface ShapeOption {
  rot: number;
  /** Arc-aware bbox of the rotated outline (sheet containment, as the rectangle placer). */
  w: number;
  h: number;
  fp: Footprint;
}

function ringOf(points: readonly Point[]): Ring {
  const n = points.length;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  points.forEach((p, i) => {
    xs[i] = p.x;
    ys[i] = p.y;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  });
  return { xs, ys, minX, minY, maxX, maxY };
}

/**
 * Polygon points of a closed bulge polyline whose region left of travel covers the true one:
 * an arc with its centre on the left (bulge > 0) is circumscribed (tangent points), an arc with
 * its centre on the right by chords. Error ≤ NEST_CURVE_TOL (or the MAX_ARC_PIECES cap).
 */
export function discretise(poly: Polyline, tol: number = NEST_CURVE_TOL): Point[] {
  const out: Point[] = [];
  const vs = poly.vertices;
  const n = vs.length;
  for (let i = 0; i < n; i++) {
    const a = vs[i] as Polyline['vertices'][number];
    const b = vs[(i + 1) % n] as Polyline['vertices'][number];
    out.push({ x: a.x, y: a.y });
    const arc = arcOf(a, b, a.bulge);
    if (!arc) continue;
    const { center: c, radius: r, startAngle, sweep } = arc;
    const maxStep = r > tol ? 2 * Math.acos(1 - tol / r) : Math.PI / 2;
    const pieces = Math.min(MAX_ARC_PIECES, Math.max(1, Math.ceil(Math.abs(sweep) / maxStep)));
    const step = sweep / pieces;
    if (a.bulge > 0) {
      // Circumscribed: tangent intersections at r / cos(step/2), between the piece ends.
      const rr = r / Math.cos(step / 2);
      for (let k = 0; k < pieces; k++) {
        const t = startAngle + step * (k + 0.5);
        out.push({ x: c.x + rr * Math.cos(t), y: c.y + rr * Math.sin(t) });
      }
    } else {
      for (let k = 1; k < pieces; k++) {
        const t = startAngle + step * k;
        out.push({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) });
      }
    }
  }
  return out;
}

/** The w × h rectangle (CCW) of a part without an outline. */
export function rectOutline(w: number, h: number): Polyline {
  const v = (x: number, y: number) => ({ x, y, bulge: 0 });
  return { closed: true, vertices: [v(0, 0), v(w, 0), v(w, h), v(0, h)] };
}

/** Bounding-box rectangle (CCW) of a polyline grown by `s`: the fallback footprint. */
function boxPoly(poly: Polyline, s: number): Polyline {
  const b = bbox(poly);
  const v = (x: number, y: number) => ({ x, y, bulge: 0 });
  return {
    closed: true,
    vertices: [
      v(b.minX - s, b.minY - s),
      v(b.maxX + s, b.minY - s),
      v(b.maxX + s, b.maxY + s),
      v(b.minX - s, b.maxY + s),
    ],
  };
}

/**
 * Local footprint polylines of a part (exact arcs): the outline offset outward by `s` and every
 * inner offset inward by `s`. An outline the offset cannot handle falls back to its bbox grown by
 * `s` (conservative); an inner that fails or collapses gives no hole zone (conservative).
 */
export function footprintContours(
  outline: Polyline,
  inners: readonly Polyline[],
  s: number,
): { outer: Polyline; holes: Polyline[] } {
  const own = normalize(outline, 'outer');
  let outer: Polyline = own;
  if (s > 0) {
    const res = offset(own, s);
    const loop = res.ok && res.polylines.length === 1 ? res.polylines[0] : undefined;
    outer = loop ?? boxPoly(own, s);
  }
  const holes: Polyline[] = [];
  for (const inner of inners) {
    const cw = normalize(inner, 'inner');
    if (s <= 0) {
      holes.push(cw);
      continue;
    }
    const res = offset(cw, s);
    if (res.ok) holes.push(...res.polylines);
  }
  return { outer, holes };
}

/**
 * The footprint of a part at rotation `rot` in the placement frame: rotated about the local origin,
 * then shifted so the rotated outline's arc-aware bbox minimum is (0, 0) (`placedOutline`).
 */
export function shapeOption(
  outline: Polyline,
  contours: { outer: Polyline; holes: readonly Polyline[] },
  rot: number,
): ShapeOption {
  const turned = rotate(normalize(outline, 'outer'), rot);
  const box = bbox(turned);
  const shift = (p: Point): Point => ({ x: p.x - box.minX, y: p.y - box.minY });
  const first = turned.vertices[0] ?? { x: box.minX, y: box.minY };
  return {
    rot,
    w: box.maxX - box.minX,
    h: box.maxY - box.minY,
    fp: {
      outer: ringOf(discretise(rotate(contours.outer, rot)).map(shift)),
      holes: contours.holes.map((h) => ringOf(discretise(rotate(h, rot)).map(shift))),
      anchor: shift(first),
    },
  };
}

/** A ring moved by (dx, dy). */
export function moveRing(r: Ring, dx: number, dy: number): Ring {
  const n = r.xs.length;
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = (r.xs[i] as number) + dx;
    ys[i] = (r.ys[i] as number) + dy;
  }
  return { xs, ys, minX: r.minX + dx, minY: r.minY + dy, maxX: r.maxX + dx, maxY: r.maxY + dy };
}

/** A footprint moved by (dx, dy). */
export function moveFootprint(fp: Footprint, dx: number, dy: number): Footprint {
  return {
    outer: moveRing(fp.outer, dx, dy),
    holes: fp.holes.map((h) => moveRing(h, dx, dy)),
    anchor: { x: fp.anchor.x + dx, y: fp.anchor.y + dy },
  };
}

function boxesOverlap(a: Ring, b: Ring): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** Whether two rings' edges cross properly (touching and collinear contact do not count). */
function ringsCross(a: Ring, b: Ring): boolean {
  if (!boxesOverlap(a, b)) return false;
  const na = a.xs.length;
  const nb = b.xs.length;
  for (let i = 0; i < na; i++) {
    const p1x = a.xs[i] as number;
    const p1y = a.ys[i] as number;
    const p2x = a.xs[(i + 1) % na] as number;
    const p2y = a.ys[(i + 1) % na] as number;
    // Skip edges outside the other ring's box.
    if (Math.max(p1x, p2x) <= b.minX || Math.min(p1x, p2x) >= b.maxX) continue;
    if (Math.max(p1y, p2y) <= b.minY || Math.min(p1y, p2y) >= b.maxY) continue;
    for (let j = 0; j < nb; j++) {
      const q1x = b.xs[j] as number;
      const q1y = b.ys[j] as number;
      const q2x = b.xs[(j + 1) % nb] as number;
      const q2y = b.ys[(j + 1) % nb] as number;
      if (Math.max(q1x, q2x) <= Math.min(p1x, p2x) || Math.min(q1x, q2x) >= Math.max(p1x, p2x))
        continue;
      if (Math.max(q1y, q2y) <= Math.min(p1y, p2y) || Math.min(q1y, q2y) >= Math.max(p1y, p2y))
        continue;
      const d1 = cross(q1x, q1y, q2x, q2y, p1x, p1y);
      const d2 = cross(q1x, q1y, q2x, q2y, p2x, p2y);
      if (!((d1 > CROSS_EPS && d2 < -CROSS_EPS) || (d1 < -CROSS_EPS && d2 > CROSS_EPS))) continue;
      const d3 = cross(p1x, p1y, p2x, p2y, q1x, q1y);
      const d4 = cross(p1x, p1y, p2x, p2y, q2x, q2y);
      if ((d3 > CROSS_EPS && d4 < -CROSS_EPS) || (d3 < -CROSS_EPS && d4 > CROSS_EPS)) return true;
    }
  }
  return false;
}

/** -1 outside, 0 on the boundary (within CROSS_EPS), 1 inside. */
function pointInRing(r: Ring, x: number, y: number): -1 | 0 | 1 {
  if (x < r.minX || x > r.maxX || y < r.minY || y > r.maxY) return -1;
  const n = r.xs.length;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r.xs[i] as number;
    const yi = r.ys[i] as number;
    const xj = r.xs[j] as number;
    const yj = r.ys[j] as number;
    const c = cross(xj, yj, xi, yi, x, y);
    if (
      Math.abs(c) <= CROSS_EPS * Math.max(1, Math.hypot(xi - xj, yi - yj)) &&
      x >= Math.min(xi, xj) - 1e-9 &&
      x <= Math.max(xi, xj) + 1e-9 &&
      y >= Math.min(yi, yj) - 1e-9 &&
      y <= Math.max(yi, yj) + 1e-9
    )
      return 0;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside ? 1 : -1;
}

/** Whether a point lies strictly inside a footprint's occupied region (outer minus hole zones). */
export function pointOccupied(fp: Footprint, x: number, y: number): boolean {
  if (pointInRing(fp.outer, x, y) !== 1) return false;
  return fp.holes.every((h) => pointInRing(h, x, y) === -1);
}

/** Vertices and edge midpoints of a ring, the anchor first. */
function probes(fp: Footprint, test: (x: number, y: number) => boolean): boolean {
  if (test(fp.anchor.x, fp.anchor.y)) return true;
  const r = fp.outer;
  const n = r.xs.length;
  for (let i = 0; i < n; i++) {
    const x = r.xs[i] as number;
    const y = r.ys[i] as number;
    if (test(x, y)) return true;
    const k = (i + 1) % n;
    if (test((x + (r.xs[k] as number)) / 2, (y + (r.ys[k] as number)) / 2)) return true;
  }
  return false;
}

/**
 * Whether the occupied regions of two footprints (same frame) overlap with positive area.
 * Touching is allowed. Proper edge crossings of any rings, else a probe point (anchor, outer
 * vertices and edge midpoints) of one strictly inside the other's occupied region.
 */
export function footprintsOverlap(a: Footprint, b: Footprint): boolean {
  if (!boxesOverlap(a.outer, b.outer)) return false;
  const ra = [a.outer, ...a.holes];
  const rb = [b.outer, ...b.holes];
  for (const x of ra) for (const y of rb) if (ringsCross(x, y)) return true;
  return probes(b, (x, y) => pointOccupied(a, x, y)) || probes(a, (x, y) => pointOccupied(b, x, y));
}
