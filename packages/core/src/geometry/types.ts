import type { Vertex } from '../schema/project';

export type { Vertex };

/** A point in millimetres. */
export interface Point {
  x: number;
  y: number;
}

/**
 * Bulge polyline (spec §6.1). Segment i runs from `vertices[i]` to `vertices[i + 1]` and is an
 * arc when `vertices[i].bulge !== 0` (bulge = tan(θ/4), θ the signed sweep, + = CCW).
 * When `closed`, the last vertex connects back to the first; when open, the last vertex's bulge is
 * ignored.
 */
export interface Polyline {
  vertices: Vertex[];
  closed: boolean;
}

/** Axis-aligned bounding box. */
export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Contour direction: counter-clockwise, clockwise, or none (zero area). */
export type Orientation = 'ccw' | 'cw' | 'none';

/** Contour role: outer contours are stored CCW, inner contours CW (spec §6.1). */
export type ContourRole = 'outer' | 'inner';
