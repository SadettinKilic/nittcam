/**
 * Drawing-tool geometry (T127–T129, spec §4.4, §6.1): pure helpers the board's rectangle, circle,
 * line/polyline and arc tools use while drawing. In-progress shapes are UI state; only the
 * finished shape becomes a command (`drawPart`, `setSegmentBulge`).
 */
import { EPS, JOIN_TOL, MIN_BULGE } from '../geometry/constants';
import { bbox, close, contour, normalize } from '../geometry/polyline';
import { arcOf } from '../geometry/segment';
import type { Point, Vertex } from '../geometry/types';

/** Values are kept to 1e-6 mm: typed sizes stay exact, float dust (0.30000000000000004) goes. */
export function tidy(v: number): number {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
}

/** Axis-aligned rectangle spanned by two opposite corners: lower-left corner and size. */
export function rectFromCorners(
  a: Point,
  b: Point,
): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

/**
 * Rectangle of a typed size "W;H" drawn from a first corner towards the cursor: the size grows in
 * the direction of the cursor (quadrant), so the typed corner stays where the user clicked.
 */
export function rectFromSize(
  corner: Point,
  toward: Point,
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number } {
  const x = toward.x < corner.x ? corner.x - w : corner.x;
  const y = toward.y < corner.y ? corner.y - h : corner.y;
  return { x, y, w, h };
}

/**
 * Circle of radius r as a closed CCW bulge contour in its local frame (box 0..2r): two half
 * arcs (bulge 1). Same model as a DXF LWPOLYLINE circle, so G2/G3 come out directly.
 */
export function circleOutline(r: number): Vertex[] {
  return [
    { x: 0, y: tidy(r), bulge: 1 },
    { x: tidy(2 * r), y: tidy(r), bulge: 1 },
  ];
}

/** Angle in degrees (CCW from +X, 0 ≤ a < 360) of the direction a → b. */
export function angleOf(a: Point, b: Point): number {
  const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  return tidy((deg + 360) % 360);
}

/**
 * Next polyline vertex from `from` towards `cursor`. A typed `length` (mm) and/or `angle`
 * (degrees, CCW from +X) override the cursor; `lock` rounds the direction to 45° steps (Shift).
 */
export function nextVertex(
  from: Point,
  cursor: Point,
  opts: { length?: number; angle?: number; lock?: boolean } = {},
): Point {
  if (opts.length === undefined && opts.angle === undefined && !opts.lock) return { ...cursor };
  const free = angleOf(from, cursor);
  const deg = opts.angle ?? (opts.lock ? (Math.round(free / 45) * 45) % 360 : free);
  const rad = (deg * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  // Without a typed length, the cursor's distance projected on the direction is used.
  const len =
    opts.length ??
    (opts.lock || opts.angle !== undefined
      ? Math.max(0, (cursor.x - from.x) * ux + (cursor.y - from.y) * uy)
      : Math.hypot(cursor.x - from.x, cursor.y - from.y));
  return { x: tidy(from.x + len * ux), y: tidy(from.y + len * uy) };
}

/** True when `p` closes a polyline that starts at `start` (spec §4.4: within JOIN_TOL). */
export function closesAt(start: Point, p: Point, tol = JOIN_TOL): boolean {
  return Math.hypot(p.x - start.x, p.y - start.y) <= tol;
}

/**
 * Bulge of the arc from p0 to p1 through m (3-point arc). Positive (CCW) when m lies right of the
 * chord p0 → p1. Collinear points give 0 (a line); m on an end point gives 0 too.
 */
export function bulgeThrough(p0: Point, m: Point, p1: Point): number {
  const ax = p0.x - m.x;
  const ay = p0.y - m.y;
  const bx = p1.x - m.x;
  const by = p1.y - m.y;
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la < EPS || lb < EPS) return 0;
  const cosPhi = Math.min(1, Math.max(-1, (ax * bx + ay * by) / (la * lb)));
  const phi = Math.acos(cosPhi); // inscribed angle at m, 0..π
  const cross = (p1.x - p0.x) * (m.y - p0.y) - (p1.y - p0.y) * (m.x - p0.x);
  const b = Math.tan((Math.PI - phi) / 2);
  if (Math.abs(cross) < EPS * EPS || b < MIN_BULGE) return 0;
  return cross < 0 ? b : -b;
}

/**
 * Bulge of the segment p0 → p1 bent so that its middle passes through m's offset from the chord
 * (drag the segment middle): sagitta h = signed distance of m from the chord, bulge = 2h / chord.
 */
export function bulgeFromSagitta(p0: Point, p1: Point, m: Point): number {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const c = Math.hypot(dx, dy);
  if (c < EPS) return 0;
  const mx = (p0.x + p1.x) / 2;
  const my = (p0.y + p1.y) / 2;
  // Right normal (dy, −dx) / c: positive bulge bends to the right of travel.
  const h = ((m.x - mx) * dy - (m.y - my) * dx) / c;
  const b = (2 * h) / c;
  return Math.abs(b) < MIN_BULGE ? 0 : b;
}

/**
 * Bulge of the minor arc p0 → p1 with radius r, bent to the right of the chord when `right`
 * (CCW, bulge > 0). Undefined when r is smaller than half the chord (no such arc).
 */
export function bulgeFromRadius(
  p0: Point,
  p1: Point,
  r: number,
  right: boolean,
): number | undefined {
  const c = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  if (c < EPS || !(r > 0) || r < c / 2 - EPS) return undefined;
  const half = Math.asin(Math.min(1, c / (2 * r))); // θ/2
  const b = Math.tan(half / 2);
  return right ? b : -b;
}

/** Radius of a segment's arc, or undefined for a line. */
export function arcRadius(p0: Point, p1: Point, bulge: number): number | undefined {
  return arcOf(p0, p1, bulge)?.radius;
}

/**
 * Closes a drawn path (board coordinates, `bulge` per segment) when its last point is within
 * JOIN_TOL of the first: the result is the closed contour, else undefined (open: "kapalı değil").
 */
export function closePath(points: readonly Vertex[]): Vertex[] | undefined {
  if (points.length < 3) return undefined;
  const first = points[0] as Vertex;
  const last = points[points.length - 1] as Vertex;
  if (!closesAt(first, last)) return undefined;
  const closed = close({ vertices: points.map((v) => ({ ...v })), closed: false });
  if (!closed.closed) return undefined;
  const vs = closed.vertices;
  if (vs.length < 3 && !vs.some((v) => v.bulge !== 0)) return undefined;
  return vs;
}

/**
 * A closed contour in board coordinates as a part: the outline normalised CCW in a local frame
 * whose origin is the arc-aware bounding box's lower-left corner, and that corner's board position.
 */
export function placeOutline(vertices: readonly Vertex[]): { at: Point; outline: Vertex[] } {
  const poly = normalize(contour(vertices.map((v) => ({ ...v }))), 'outer');
  const b = bbox(poly);
  const at = { x: tidy(b.minX), y: tidy(b.minY) };
  return {
    at,
    outline: poly.vertices.map((v) => ({
      x: tidy(v.x - at.x),
      y: tidy(v.y - at.y),
      bulge: v.bulge,
    })),
  };
}

/**
 * Next free default part name: `template` with {n} = parts + 1, counting up while the name is
 * taken ("Parça 6").
 */
export function nextPartName(template: string, taken: readonly string[]): string {
  const used = new Set(taken.map((n) => n.trim()));
  let n = taken.length + 1;
  let name = template.replace('{n}', String(n));
  while (used.has(name)) {
    n += 1;
    name = template.replace('{n}', String(n));
  }
  return name;
}
