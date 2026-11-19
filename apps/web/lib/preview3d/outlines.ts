import { sampleSegment, type Polyline } from '@nittcam/core';

/** Chord samples per arc for display (spec §3.8: arcs tessellated for display only). */
export const ARC_STEPS = 16;

/** A closed polyline as flat [x, y, …] in mm, arcs sampled (the closing point is not repeated). */
export function flatten(poly: Polyline, steps = ARC_STEPS): number[] {
  const n = poly.vertices.length;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const v = poly.vertices[i];
    const next = poly.vertices[(i + 1) % n];
    if (!v || !next) continue;
    if (v.bulge === 0) out.push(v.x, v.y);
    else for (const p of sampleSegment(v, next, v.bulge, steps).slice(0, -1)) out.push(p.x, p.y);
  }
  return out;
}
