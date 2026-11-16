/**
 * Rigid transforms of bulge polylines: translate, rotate by quarter turns, mirror.
 * Quarter-turn rotations swap and negate coordinates (no sin/cos), so 90/180/270° are exact.
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
  rotate?: QuarterTurn;
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

/** Rotation keeps bulges (and orientation). */
export function rotate(poly: Polyline, deg: QuarterTurn): Polyline {
  return mapVertices(poly, (v) => ({ ...rotatePoint(v, deg), bulge: v.bulge }));
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
