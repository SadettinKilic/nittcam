/**
 * Inner contours (T134, spec §4.3, §6.1): checks for a cut-out drawn inside a part. Pure.
 *
 * An inner contour must be a closed, non-crossing shape with area, lie strictly inside the part
 * outline, not touch or overlap another inner contour, and be large enough for the tool: the
 * tool-centre path (offset by the tool radius into the opening, the same offset the toolpath
 * uses) must be one closed loop. Arcs are sampled for the containment tests (editor guard).
 */
import { EPS } from '../geometry/constants';
import { offset } from '../geometry/offset';
import { contour, forEachSegment, normalize, signedArea } from '../geometry/polyline';
import { sampleSegment } from '../geometry/segment';
import type { Point, Vertex } from '../geometry/types';
import { segmentsMeet, selfCrosses } from './edit';

export type InnerContourError = 'degenerate' | 'crossing' | 'outside' | 'overlap' | 'tooSmall';

/** The closed contour as a sampled polygon (16 chords per arc). */
function polygon(vs: readonly Vertex[]): Point[] {
  const pts: Point[] = [];
  forEachSegment(contour(vs), (a, b, bulge) => {
    const s = sampleSegment(a, b, bulge, 16);
    s.pop();
    pts.push(...s);
  });
  return pts;
}

/** Ray casting; points on the boundary count as either side (callers test crossings first). */
function inside(poly: readonly Point[], p: Point): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Point;
    const b = poly[j] as Point;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      hit = !hit;
    }
  }
  return hit;
}

/** Does any edge of `a` meet (cross or touch) any edge of `b`? */
function meet(a: readonly Point[], b: readonly Point[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const p = a[i] as Point;
    const q = a[(i + 1) % a.length] as Point;
    for (let j = 0; j < b.length; j++) {
      if (segmentsMeet(p, q, b[j] as Point, b[(j + 1) % b.length] as Point)) return true;
    }
  }
  return false;
}

/**
 * Can the tool cut this opening? The tool-centre path of the CW contour offset by the tool radius
 * (into the opening) must be one closed loop; a failed offset (opening smaller than the tool) or
 * a split (a neck the tool cannot pass) means no.
 */
export function innerFitsTool(vs: readonly Vertex[], toolDiameter: number): boolean {
  if (!(toolDiameter > 0)) return true;
  const res = offset(normalize(contour(vs.map((v) => ({ ...v }))), 'inner'), toolDiameter / 2);
  return res.ok && res.polylines.length === 1 && !res.warnings.includes('SPLIT');
}

/**
 * Checks a candidate inner contour against the part outline and its other inner contours (all in
 * the same frame). `toolDiameter` 0 skips the tool rule. Undefined = valid.
 */
export function checkInnerContour(
  outline: readonly Vertex[],
  inners: readonly (readonly Vertex[])[],
  candidate: readonly Vertex[],
  toolDiameter = 0,
): InnerContourError | undefined {
  if (candidate.length < 2) return 'degenerate';
  if (Math.abs(signedArea(contour(candidate))) < EPS) return 'degenerate';
  if (selfCrosses(candidate)) return 'crossing';
  const c = polygon(candidate);
  const o = polygon(outline);
  if (meet(c, o) || !c.every((p) => inside(o, p))) return 'outside';
  for (const other of inners) {
    const q = polygon(other);
    if (q.length === 0) continue;
    if (meet(c, q) || inside(q, c[0] as Point) || inside(c, q[0] as Point)) return 'overlap';
  }
  if (!innerFitsTool(candidate, toolDiameter)) return 'tooSmall';
  return undefined;
}

/** A candidate inner contour stored CW (spec §6.1), coordinates as given. */
export function normalizeInner(vs: readonly Vertex[]): Vertex[] {
  return normalize(contour(vs.map((v) => ({ ...v }))), 'inner').vertices;
}
