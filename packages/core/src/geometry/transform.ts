/**
 * Rigid transforms of bulge polylines: translate, rotate, mirror.
 * Quarter-turn rotations swap and negate coordinates (no sin/cos), so 0/90/180/270° stay exact
 * (and existing outputs byte-identical); any other angle uses cos/sin (D-034).
 */
import { negate } from './polyline';
import type { Point, Polyline, Vertex } from './types';

/** Rotation in degrees, counter-clockwise about the origin. */
export type QuarterTurn = 0 | 90 | 180 | 270;

/** Mirror axis: 'x' flips x (x → −x, mirror across the Y axis); 'y' flips y (y → −y). */
export type MirrorAxis = 'x' | 'y';

/** Applied in this order: mirror, then rotate about the origin, then translate. */
export interface Transform {
  mirror?: MirrorAxis;
  /** CCW degrees; any angle (quarter turns are exact). */
  rotate?: number;
  dx?: number;
  dy?: number;
}

/** Rotates a point CCW about the origin by a quarter turn, exactly. */
export function rotatePoint(p: Point, deg: QuarterTurn): Point {
  switch (deg) {
    case 0:
      return { x: p.x, y: p.y };
    case 90:
      return { x: negate(p.y), y: p.x };
    case 180:
      return { x: negate(p.x), y: negate(p.y) };
    case 270:
      return { x: p.y, y: negate(p.x) };
  }
}

function mapVertices(poly: Polyline, fn: (v: Vertex) => Vertex): Polyline {
  return { vertices: poly.vertices.map(fn), closed: poly.closed };
}

export function translate(poly: Polyline, dx: number, dy: number): Polyline {
  return mapVertices(poly, (v) => ({ x: v.x + dx, y: v.y + dy, bulge: v.bulge }));
}

/** True for 0/90/180/270 (after reduction to [0, 360)). */
export function isQuarterTurn(deg: number): deg is QuarterTurn {
  return deg === 0 || deg === 90 || deg === 180 || deg === 270;
}

/** Reduces degrees to [0, 360). */
function reduceDeg(deg: number): number {
  const r = ((deg % 360) + 360) % 360;
  return r === 0 ? 0 : r;
}

/**
 * Rotates a point CCW about the origin by any angle in degrees. Quarter turns go through
 * `rotatePoint` (exact); other angles use cos/sin.
 */
export function rotatePointBy(p: Point, deg: number): Point {
  const d = reduceDeg(deg);
  if (isQuarterTurn(d)) return rotatePoint(p, d);
  const rad = (d * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** Rotation (CCW degrees, any angle) keeps bulges (and orientation): arcs stay arcs. */
export function rotate(poly: Polyline, deg: number): Polyline {
  return mapVertices(poly, (v) => ({ ...rotatePointBy(v, deg), bulge: v.bulge }));
}

/**
 * Mirroring reverses the turning sense: bulges are negated and the orientation flips (a CCW
 * contour becomes CW). Call `normalize` afterwards to restore the stored direction.
 */
export function mirror(poly: Polyline, axis: MirrorAxis): Polyline {
  return mapVertices(poly, (v) => ({
    x: axis === 'x' ? negate(v.x) : v.x,
    y: axis === 'y' ? negate(v.y) : v.y,
    bulge: negate(v.bulge),
  }));
}

/** Mirror, then rotate about the origin, then translate. */
export function transform(poly: Polyline, t: Transform): Polyline {
  let out: Polyline = { vertices: poly.vertices.map((v) => ({ ...v })), closed: poly.closed };
  if (t.mirror) out = mirror(out, t.mirror);
  if (t.rotate) out = rotate(out, t.rotate);
  if (t.dx || t.dy) out = translate(out, t.dx ?? 0, t.dy ?? 0);
  return out;
}
