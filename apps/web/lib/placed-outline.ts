import { placedOutline, sampleSegment, type Part } from '@nittcam/core';

const QUARTER = 1e-6;

/** True for 0/90/180/270 (an axis-aligned rectangle stays a rectangle). */
export function isQuarterTurn(rot: number): boolean {
  const r = ((rot % 90) + 90) % 90;
  return r < QUARTER || 90 - r < QUARTER;
}

/**
 * The true outline of a placed part relative to its footprint (T116, D-034): flat [x, y, …] in mm
 * with Y **down** from the footprint's top-left corner (canvas/SVG frame), arcs sampled.
 * Null when the footprint rectangle already is the outline (a rectangle at a quarter turn), so
 * the common case keeps drawing a plain rectangle.
 */
export function footprintOutline(part: Part, rot: number, h: number): number[] | null {
  if (part.kind === 'rect' && isQuarterTurn(rot)) return null;
  const poly = placedOutline(part, { x: 0, y: 0, rot });
  const n = poly.vertices.length;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = poly.vertices[i];
    const next = poly.vertices[(i + 1) % n];
    if (!v || !next) continue;
    const pts = v.bulge === 0 ? [v] : sampleSegment(v, next, v.bulge, 12).slice(0, -1);
    for (const p of pts) out.push(round(p.x), round(h - p.y));
  }
  return out;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
