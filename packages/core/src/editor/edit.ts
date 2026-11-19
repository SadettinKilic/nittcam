/**
 * Outline edits of the properties panel (T130, spec §4.4): segment length and angle, vertex
 * position. Pure helpers on a part's outline (part frame, CCW, implicitly closed); the commands in
 * `commands/part/edit.ts` and the panel's live validation both call them, so the panel can show a
 * Turkish error for the same reason the command refuses.
 *
 * Rule (§4.4 "Uzunluk değişimi"): the segment's end vertex moves along the segment's direction and
 * the next segment follows it (its far end stays). No constraint solver.
 */
import { EPS } from '../geometry/constants';
import { contour, forEachSegment, orientation } from '../geometry/polyline';
import { arcOf, sampleSegment, segmentLength } from '../geometry/segment';
import type { Point, Vertex } from '../geometry/types';
import { angleOf, tidy } from './draw';

/** Why an outline edit is refused; the UI maps each code to a Turkish message. */
export type OutlineEditError =
  /** No such segment / vertex. */
  | 'index'
  /** Length (or radius) must be a positive number. */
  | 'length'
  /** The outline would have no area or would turn inside out. */
  | 'degenerate'
  /** The outline would cross itself. */
  | 'crossing';

export type OutlineEdit = { ok: true; vertices: Vertex[] } | { ok: false; error: OutlineEditError };

/** What the panel shows for one segment. Angle in degrees CCW from +X (0 ≤ a < 360). */
export interface SegmentInfo {
  /** Path length (arc length for arcs), mm. */
  length: number;
  /** Direction of the chord start → end, degrees. */
  angle: number;
  /** Arc radius, mm; undefined for a straight line. */
  radius: number | undefined;
}

function at(vs: readonly Vertex[], i: number): Vertex {
  const n = vs.length;
  return vs[((i % n) + n) % n] as Vertex;
}

/** Length, angle and radius of segment `index` (vertex index → index + 1). */
export function segmentInfo(vs: readonly Vertex[], index: number): SegmentInfo | undefined {
  if (!Number.isInteger(index) || index < 0 || index >= vs.length || vs.length < 2)
    return undefined;
  const a = at(vs, index);
  const b = at(vs, index + 1);
  return {
    length: tidy(segmentLength(a, b, a.bulge)),
    angle: angleOf(a, b),
    radius: ((r) => (r === undefined ? undefined : tidy(r)))(arcOf(a, b, a.bulge)?.radius),
  };
}

/** Do the closed segments p–q and r–s cross or touch (beyond EPS)? */
export function segmentsMeet(p: Point, q: Point, r: Point, s: Point): boolean {
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const d1 = cross(r, s, p);
  const d2 = cross(r, s, q);
  const d3 = cross(p, q, r);
  const d4 = cross(p, q, s);
  const tol = EPS * EPS;
  if (
    ((d1 > tol && d2 < -tol) || (d1 < -tol && d2 > tol)) &&
    ((d3 > tol && d4 < -tol) || (d3 < -tol && d4 > tol))
  ) {
    return true;
  }
  // Collinear overlap or an end point on the other segment.
  const on = (a: Point, b: Point, c: Point, d: number) =>
    Math.abs(d) <= tol * 1e3 &&
    Math.min(a.x, b.x) - EPS <= c.x &&
    c.x <= Math.max(a.x, b.x) + EPS &&
    Math.min(a.y, b.y) - EPS <= c.y &&
    c.y <= Math.max(a.y, b.y) + EPS;
  return on(r, s, p, d1) || on(r, s, q, d2) || on(p, q, r, d3) || on(p, q, s, d4);
}

/**
 * Does the closed outline cross itself? Arcs are sampled (16 chords per arc), which is plenty for
 * an editor guard; touching neighbours at their shared vertex do not count.
 */
export function selfCrosses(vs: readonly Vertex[]): boolean {
  const pts: Point[] = [];
  forEachSegment(contour(vs), (a, b, bulge) => {
    const s = sampleSegment(a, b, bulge, 16);
    s.pop();
    pts.push(...s);
  });
  const n = pts.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const p = pts[i] as Point;
    const q = pts[(i + 1) % n] as Point;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // neighbours through the closing chord
      const r = pts[j] as Point;
      const s = pts[(j + 1) % n] as Point;
      if (segmentsMeet(p, q, r, s)) return true;
    }
  }
  return false;
}

/** The checks every outline edit's result must pass: CCW with area, no crossing. */
export function checkOutline(vs: readonly Vertex[]): OutlineEditError | undefined {
  if (vs.length < 2) return 'degenerate';
  for (let i = 0; i < vs.length; i++) {
    const a = at(vs, i);
    const b = at(vs, i + 1);
    if (Math.hypot(b.x - a.x, b.y - a.y) < EPS) return 'degenerate';
  }
  if (orientation(contour(vs)) !== 'ccw') return 'degenerate';
  if (selfCrosses(vs)) return 'crossing';
  return undefined;
}

function finish(vs: Vertex[]): OutlineEdit {
  const error = checkOutline(vs);
  return error ? { ok: false, error } : { ok: true, vertices: vs };
}

/** Moves the end vertex of segment `index` to `to`; everything else stays. */
function moveEnd(vs: readonly Vertex[], index: number, to: Point): Vertex[] {
  const end = (index + 1) % vs.length;
  return vs.map((v, i) =>
    i === end ? { x: tidy(to.x), y: tidy(to.y), bulge: v.bulge } : { ...v },
  );
}

/**
 * Segment `index` with a new path length: the end vertex slides along the chord direction (an arc
 * keeps its bulge, so its sweep stays and its chord scales with the length); the next segment
 * follows.
 */
export function withSegmentLength(
  vs: readonly Vertex[],
  index: number,
  length: number,
): OutlineEdit {
  const info = segmentInfo(vs, index);
  if (!info) return { ok: false, error: 'index' };
  if (!Number.isFinite(length) || length < EPS) return { ok: false, error: 'length' };
  const a = at(vs, index);
  const b = at(vs, index + 1);
  const k = length / segmentLength(a, b, a.bulge);
  return finish(moveEnd(vs, index, { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }));
}

/** Segment `index` turned to `angle` degrees (chord direction) about its start; length kept. */
export function withSegmentAngle(vs: readonly Vertex[], index: number, angle: number): OutlineEdit {
  const info = segmentInfo(vs, index);
  if (!info) return { ok: false, error: 'index' };
  if (!Number.isFinite(angle)) return { ok: false, error: 'length' };
  const a = at(vs, index);
  const b = at(vs, index + 1);
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  const rad = (angle * Math.PI) / 180;
  return finish(
    moveEnd(vs, index, { x: a.x + chord * Math.cos(rad), y: a.y + chord * Math.sin(rad) }),
  );
}

/** Vertex `index` moved to `to` (part frame); both neighbouring segments follow. */
export function withVertexAt(vs: readonly Vertex[], index: number, to: Point): OutlineEdit {
  if (!Number.isInteger(index) || index < 0 || index >= vs.length)
    return { ok: false, error: 'index' };
  if (!Number.isFinite(to.x) || !Number.isFinite(to.y)) return { ok: false, error: 'length' };
  return finish(moveEnd(vs, (index - 1 + vs.length) % vs.length, to));
}

/**
 * Bulge of segment p0 → p1 for a new arc radius, keeping the side it bends to and whether it is
 * the minor or the major arc. A straight segment bends outwards (bulge > 0, to the right of a CCW
 * outline). `undefined` when the radius is below half the chord (no such arc).
 */
export function bulgeForRadius(p0: Point, p1: Point, r: number, bulge: number): number | undefined {
  const c = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  if (c < EPS || !(r > 0) || r < c / 2 - EPS) return undefined;
  const half = Math.asin(Math.min(1, c / (2 * r))); // half sweep of the minor arc
  const major = Math.abs(bulge) > 1;
  const b = Math.tan((major ? Math.PI - half : half) / 2);
  return bulge < 0 ? -b : b;
}
