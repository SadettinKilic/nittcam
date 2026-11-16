/**
 * Whole-polyline functions: area, orientation, normalisation, bbox, length, closing.
 * Pure: inputs are never mutated; every function returns new objects.
 */
import { EPS, JOIN_TOL } from './constants';
import { segmentArea, segmentBBox, segmentLength } from './segment';
import type { BBox, ContourRole, Orientation, Point, Polyline, Vertex } from './types';

/** Negation that never yields −0 (keeps deep equality with literal 0 in tests and JSON). */
export function negate(v: number): number {
  return 0 - v;
}

/** A closed polyline from a stored contour (outline / inner vertex array, implicitly closed). */
export function contour(vertices: readonly Vertex[]): Polyline {
  return { vertices: vertices.map((v) => ({ ...v })), closed: true };
}

/** Calls `fn(p0, p1, bulge)` for every segment (n − 1 when open, n when closed). */
export function forEachSegment(
  poly: Polyline,
  fn: (p0: Vertex, p1: Vertex, bulge: number, index: number) => void,
): void {
  const vs = poly.vertices;
  const n = vs.length;
  const count = poly.closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = vs[i] as Vertex;
    const b = vs[(i + 1) % n] as Vertex;
    fn(a, b, a.bulge, i);
  }
}

/**
 * Signed area in mm² (+ = CCW). Arcs are exact: shoelace over the chords plus each circular
 * segment's area. An open polyline is measured as if closed by a straight chord.
 */
export function signedArea(poly: Polyline): number {
  let area = 0;
  forEachSegment(poly, (a, b, bulge) => {
    area += segmentArea(a, b, bulge);
  });
  const n = poly.vertices.length;
  if (!poly.closed && n >= 2) {
    const last = poly.vertices[n - 1] as Vertex;
    const first = poly.vertices[0] as Vertex;
    area += segmentArea(last, first, 0);
  }
  return area;
}

/** Direction from the signed area; |area| ≤ EPS² counts as 'none' (degenerate). */
export function orientation(poly: Polyline): Orientation {
  const a = signedArea(poly);
  if (Math.abs(a) <= EPS * EPS) return 'none';
  return a > 0 ? 'ccw' : 'cw';
}

/**
 * Same path traversed backwards. Closed: keeps the start vertex (v0, v(n−1), …, v1). Every arc
 * keeps its shape: segment i's bulge moves to the new start vertex of that segment and is negated.
 * Open: the ignored last bulge is carried along so reversing twice is the identity.
 */
export function reverse(poly: Polyline): Polyline {
  const vs = poly.vertices;
  const n = vs.length;
  if (n === 0) return { vertices: [], closed: poly.closed };
  const at = (i: number) => vs[((i % n) + n) % n] as Vertex;
  const vertices = poly.closed
    ? vs.map((_, j) => {
        const v = at(n - j);
        return { x: v.x, y: v.y, bulge: negate(at(n - j - 1).bulge) };
      })
    : vs.map((_, j) => {
        const v = at(n - 1 - j);
        // segment j of the reversed path is old segment n − 2 − j; the last slot gets the old
        // (ignored) last bulge so that reverse(reverse(p)) === p
        const bulge = j < n - 1 ? at(n - 2 - j).bulge : at(n - 1).bulge;
        return { x: v.x, y: v.y, bulge: negate(bulge) };
      });
  return { vertices, closed: poly.closed };
}

/**
 * Stored direction (spec §6.1): outer contours CCW, inner contours CW. A closed polyline with the
 * wrong direction is reversed; open or degenerate ones are returned unchanged (as a copy).
 */
export function normalize(poly: Polyline, role: ContourRole): Polyline {
  const copy = { vertices: poly.vertices.map((v) => ({ ...v })), closed: poly.closed };
  if (!poly.closed) return copy;
  const dir = orientation(poly);
  const want = role === 'outer' ? 'ccw' : 'cw';
  return dir === 'none' || dir === want ? copy : reverse(poly);
}

/** Arc-aware bounding box. Throws on an empty polyline. */
export function bbox(poly: Polyline): BBox {
  const vs = poly.vertices;
  const first = vs[0];
  if (!first) throw new RangeError('bbox of an empty polyline');
  const box: BBox = { minX: first.x, minY: first.y, maxX: first.x, maxY: first.y };
  forEachSegment(poly, (a, b, bulge) => {
    const s = segmentBBox(a, b, bulge);
    box.minX = Math.min(box.minX, s.minX);
    box.minY = Math.min(box.minY, s.minY);
    box.maxX = Math.max(box.maxX, s.maxX);
    box.maxY = Math.max(box.maxY, s.maxY);
  });
  return box;
}

/** Arc-aware path length in mm (includes the closing segment when closed). */
export function length(poly: Polyline): number {
  let total = 0;
  forEachSegment(poly, (a, b, bulge) => {
    total += segmentLength(a, b, bulge);
  });
  return total;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Closed, or open with its two ends within JOIN_TOL (spec §4.4 "kapalı kontur"). */
export function isClosed(poly: Polyline): boolean {
  if (poly.closed) return true;
  const n = poly.vertices.length;
  if (n < 3) return false;
  return distance(poly.vertices[0] as Vertex, poly.vertices[n - 1] as Vertex) <= JOIN_TOL;
}

/**
 * Joins an open polyline whose ends are within JOIN_TOL: the last vertex is dropped and the
 * segment before it now ends at the first vertex (its bulge is kept). Returns a closed copy, or an
 * unchanged open copy when the gap is too large (the caller warns "kesilemez, kapalı değil").
 */
export function close(poly: Polyline): Polyline {
  const vertices = poly.vertices.map((v) => ({ ...v }));
  if (poly.closed) return { vertices, closed: true };
  if (!isClosed(poly)) return { vertices, closed: false };
  vertices.pop();
  return { vertices, closed: true };
}
