/**
 * Holes and cut-outs of the selected part on the canvas (B52, D-092): which one is under the
 * pointer, and the board parts with one of them moved (live drag preview).
 */
import {
  bbox,
  contour,
  contourDistance,
  insideContour,
  type BoardPart,
  type Project,
} from '@nittcam/core';
import type { Pt } from './viewport';

/** A hole or an inner contour (cut-out) of the selected part, by index. */
export type PartItem = { kind: 'hole' | 'inner'; index: number };

/**
 * The hole (first) or cut-out under `p` (board mm), within `tol` mm of its edge; null = none.
 * Holes win: a hole never lies inside a cut-out, and a small hole is the harder target.
 */
export function pickItem(part: BoardPart, p: Pt, tol: number): PartItem | null {
  let best: PartItem | null = null;
  let bestD = Infinity;
  part.holes.forEach((h, index) => {
    const d = Math.hypot(p.x - h.x, p.y - h.y) - h.d / 2;
    if (d <= tol && d < bestD) {
      best = { kind: 'hole', index };
      bestD = d;
    }
  });
  if (best) return best;
  const i = part.inners.findIndex((c) => insideContour(p, c) || contourDistance(p, c) <= tol);
  return i >= 0 ? { kind: 'inner', index: i } : null;
}

/** `parts` with item `item` of part `id` shifted by d (board mm), for the drag preview. */
export function withItemMoved(
  parts: readonly BoardPart[],
  id: string,
  item: PartItem,
  d: Pt,
): BoardPart[] {
  return parts.map((p) => {
    if (p.id !== id) return p;
    if (item.kind === 'hole') {
      return {
        ...p,
        holes: p.holes.map((h, i) => (i === item.index ? { ...h, x: h.x + d.x, y: h.y + d.y } : h)),
      };
    }
    return {
      ...p,
      inners: p.inners.map((c, i) =>
        i === item.index ? c.map((v) => ({ x: v.x + d.x, y: v.y + d.y, bulge: v.bulge })) : c,
      ),
    };
  });
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * The command that moves `item` of part `id` by d (mm): `updateHole` (new centre) or
 * `updateInnerContour` (new box corner), both in the part frame. Null = no such item.
 */
export function itemMove(
  project: Project,
  id: string,
  item: PartItem,
  d: Pt,
):
  | {
      name: 'updateHole';
      params: { id: string; holeId: string; patch: { cx: number; cy: number } };
    }
  | { name: 'updateInnerContour'; params: { id: string; index: number; x: number; y: number } }
  | null {
  const part = project.parts.find((p) => p.id === id);
  if (!part) return null;
  if (item.kind === 'hole') {
    const h = part.holes[item.index];
    if (!h) return null;
    return {
      name: 'updateHole',
      params: { id, holeId: h.id, patch: { cx: r2(h.cx + d.x), cy: r2(h.cy + d.y) } },
    };
  }
  const c = part.inners[item.index];
  if (!c || c.length === 0) return null;
  const { minX: x, minY: y } = bbox(contour(c));
  return {
    name: 'updateInnerContour',
    params: { id, index: item.index, x: r2(x + d.x), y: r2(y + d.y) },
  };
}
