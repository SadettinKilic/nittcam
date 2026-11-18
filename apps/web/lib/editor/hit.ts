/** Hit testing on the drawing board (T124/T125): which part is under a point or inside a box. */
import { sampleSegment, type BoardPart, type Vertex } from '@nittcam/core';
import type { Box, Pt } from './viewport';

/** The contour as a closed polygon (arcs sampled). */
export function polygonOf(vs: readonly Vertex[]): Pt[] {
  const out: Pt[] = [];
  vs.forEach((v, i) => {
    const next = vs[(i + 1) % vs.length] ?? v;
    const pts = sampleSegment(v, next, v.bulge, 12);
    out.push(...pts.slice(0, -1));
  });
  return out;
}

function inside(poly: readonly Pt[], p: Pt): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Pt;
    const b = poly[j] as Pt;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      hit = !hit;
    }
  }
  return hit;
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Topmost part (last drawn) whose outline contains `p` or passes within `tol` mm of it. Inner
 * contours are holes in the part: a click inside a cut-out does not pick the part.
 */
export function hitPart(parts: readonly BoardPart[], p: Pt, tol: number): string | null {
  for (let k = parts.length - 1; k >= 0; k -= 1) {
    const part = parts[k] as BoardPart;
    const b = part.box;
    if (p.x < b.minX - tol || p.x > b.maxX + tol || p.y < b.minY - tol || p.y > b.maxY + tol) {
      continue;
    }
    const outer = polygonOf(part.outline);
    const near = outer.some(
      (a, i) => distToSegment(p, a, outer[(i + 1) % outer.length] as Pt) <= tol,
    );
    if (near) return part.id;
    if (inside(outer, p) && !part.inners.some((c) => inside(polygonOf(c), p))) return part.id;
  }
  return null;
}

/** Normalised box from two corner points. */
export function boxFrom(a: Pt, b: Pt): Box {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

/** Parts whose bounding box touches the selection box. */
export function partsInBox(parts: readonly BoardPart[], box: Box): string[] {
  return parts
    .filter(
      (p) =>
        p.box.minX <= box.maxX &&
        p.box.maxX >= box.minX &&
        p.box.minY <= box.maxY &&
        p.box.maxY >= box.minY,
    )
    .map((p) => p.id);
}
