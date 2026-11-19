/**
 * Hole geometry for the editor and the rules (T138, spec §4.5): the circle a hole takes out of the
 * part and whether it lies inside the part (inside the outline, clear of the cut-outs). Pure.
 */
import {
  EPS,
  arcOf,
  contour,
  forEachSegment,
  sampleSegment,
  type Point,
  type Vertex,
} from '../geometry';
import type { Hole } from '../schema/project';

/**
 * Outer radius of the material a hole removes, mm: pocket / through = d/2; a groove is a ring
 * around its centreline diameter d, so its outer edge is (d + grooveWidth)/2.
 */
export function holeOuterRadius(hole: Hole): number {
  return hole.type === 'groove' ? (hole.d + hole.grooveWidth) / 2 : hole.d / 2;
}

/** Shortest distance from `p` to one segment (line or arc), mm. */
export function segmentDistance(p: Point, a: Point, b: Point, bulge: number): number {
  const arc = arcOf(a, b, bulge);
  if (!arc) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }
  // On the arc's sweep the nearest point is radial; otherwise one of the end points.
  const ang = Math.atan2(p.y - arc.center.y, p.x - arc.center.x);
  let rel = arc.sweep >= 0 ? ang - arc.startAngle : arc.startAngle - ang;
  rel = ((rel % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const ends = Math.min(Math.hypot(p.x - a.x, p.y - a.y), Math.hypot(p.x - b.x, p.y - b.y));
  if (rel <= Math.abs(arc.sweep)) {
    return Math.min(
      ends,
      Math.abs(Math.hypot(p.x - arc.center.x, p.y - arc.center.y) - arc.radius),
    );
  }
  return ends;
}

/** Shortest distance from `p` to a closed contour, mm. */
export function contourDistance(p: Point, vs: readonly Vertex[]): number {
  let d = Number.POSITIVE_INFINITY;
  forEachSegment(contour(vs), (a, b, bulge) => {
    d = Math.min(d, segmentDistance(p, a, b, bulge));
  });
  return d;
}

/** Whether `p` lies inside a closed contour (arcs sampled finely; points on the edge are unsure). */
export function insideContour(p: Point, vs: readonly Vertex[]): boolean {
  const pts: Point[] = [];
  forEachSegment(contour(vs), (a, b, bulge) => {
    const s = sampleSegment(a, b, bulge, 64);
    pts.push(...s.slice(0, -1));
  });
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const pi = pts[i] as Point;
    const pj = pts[j] as Point;
    if (pi.y > p.y !== pj.y > p.y && p.x < ((pj.x - pi.x) * (p.y - pi.y)) / (pj.y - pi.y) + pi.x) {
      inside = !inside;
    }
  }
  return inside;
}

export type HolePlacementError = 'outside' | 'cutout';

/**
 * Whether a hole lies inside its part (spec §4.5 "delik parçanın içinde", T138): its whole circle
 * (`holeOuterRadius`) inside the outline and clear of every inner contour (a hole in a cut-out
 * would cut air and leave the part's edge broken). Touching an edge counts as outside. EPS slack.
 */
export function checkHolePlacement(
  outline: readonly Vertex[],
  inners: readonly (readonly Vertex[])[],
  hole: Hole,
): HolePlacementError | undefined {
  const c = { x: hole.cx, y: hole.cy };
  const r = holeOuterRadius(hole);
  if (!insideContour(c, outline) || contourDistance(c, outline) < r + EPS) return 'outside';
  for (const inner of inners) {
    if (insideContour(c, inner) || contourDistance(c, inner) < r + EPS) return 'cutout';
  }
  return undefined;
}
