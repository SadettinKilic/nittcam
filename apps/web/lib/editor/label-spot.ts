/**
 * Where a part's label goes on the drawing board (B50, polish P1; CTO #5, #6): a plain rectangle
 * keeps its box centre; an L part, a notched or round part, or a part with a cut-out gets a spot
 * inside the material (not over the opening or outside the L) and the room around that spot.
 * Pure; the result is cached per outline array (board parts are rebuilt when the project changes).
 */
import { contour, forEachSegment, sampleSegment, type Point, type Vertex } from '@nittcam/core';

export interface LabelSpot {
  /** Centre of the label, board mm. */
  x: number;
  y: number;
  /** Free width and height around the centre, mm (symmetric). */
  w: number;
  h: number;
}

interface Shape {
  outline: readonly Vertex[];
  inners: readonly (readonly Vertex[])[];
  box: { minX: number; minY: number; maxX: number; maxY: number };
}

/** Grid resolution of the search (per axis). */
const GRID = 24;
/** Width : height of a typical two-line part label. */
const ASPECT = 5;

function polyline(vs: readonly Vertex[]): Point[] {
  const pts: Point[] = [];
  forEachSegment(contour(vs), (a, b, bulge) => {
    pts.push(...sampleSegment(a, b, bulge, bulge === 0 ? 1 : 16).slice(0, -1));
  });
  return pts;
}

function isPlainRect(s: Shape): boolean {
  if (s.inners.length > 0 || s.outline.length !== 4) return false;
  const { minX, minY, maxX, maxY } = s.box;
  const e = 1e-6;
  return s.outline.every(
    (v) =>
      v.bulge === 0 &&
      (Math.abs(v.x - minX) < e || Math.abs(v.x - maxX) < e) &&
      (Math.abs(v.y - minY) < e || Math.abs(v.y - maxY) < e),
  );
}

/** Free distance from (x, y) along ±x and ±y to the nearest edge of any ring. */
function reach(rings: readonly Point[][], x: number, y: number) {
  let left = Infinity;
  let right = Infinity;
  let down = Infinity;
  let up = Infinity;
  let crossings = 0;
  for (const r of rings) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[j] as Point;
      const b = r[i] as Point;
      if (a.y > y !== b.y > y) {
        const ix = a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y);
        if (ix < x) left = Math.min(left, x - ix);
        else {
          right = Math.min(right, ix - x);
          crossings++;
        }
      }
      if (a.x > x !== b.x > x) {
        const iy = a.y + ((x - a.x) * (b.y - a.y)) / (b.x - a.x);
        if (iy < y) down = Math.min(down, y - iy);
        else up = Math.min(up, iy - y);
      }
    }
  }
  // Odd crossings to the right over all rings = inside the outline and outside every cut-out.
  return { inside: crossings % 2 === 1, w: 2 * Math.min(left, right), h: 2 * Math.min(down, up) };
}

function compute(s: Shape): LabelSpot {
  const { minX, minY, maxX, maxY } = s.box;
  const centre: LabelSpot = {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    w: maxX - minX,
    h: maxY - minY,
  };
  if (isPlainRect(s) || !(centre.w > 0 && centre.h > 0)) return centre;
  const rings = [polyline(s.outline), ...s.inners.map(polyline)];
  // Candidates: grid points in the material, scored by the largest label-shaped (5 : 1) box that
  // fits their free cross: an L part's label sits along its longer leg, a door's on a rail.
  // The box centre is tried first and wins ties (a round or symmetric part stays centred).
  const points: Point[] = [{ x: centre.x, y: centre.y }];
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      points.push({
        x: minX + ((i + 0.5) / GRID) * centre.w,
        y: minY + ((j + 0.5) / GRID) * centre.h,
      });
    }
  }
  let pick: LabelSpot | null = null;
  let best = -1;
  for (const { x, y } of points) {
    const r = reach(rings, x, y);
    if (!r.inside) continue;
    const score = Math.min(r.w, ASPECT * r.h) * Math.min(r.h, r.w / ASPECT);
    if (score > best) {
      best = score;
      pick = { x, y, w: r.w, h: r.h };
    }
  }
  return pick ?? centre;
}

const cache = new WeakMap<readonly Vertex[], { inners: readonly unknown[]; spot: LabelSpot }>();

/** Label centre and room of a part on the board (box centre for a plain rectangle). */
export function labelSpot(s: Shape): LabelSpot {
  const hit = cache.get(s.outline);
  if (hit && hit.inners === s.inners) return hit.spot;
  const spot = compute(s);
  cache.set(s.outline, { inners: s.inners, spot });
  return spot;
}
