/**
 * Test helpers for offset (T007): an independent point-to-contour distance and the sampled
 * distance property. Not exported from the package.
 */
import { forEachSegment } from './polyline';
import { arcOf, sampleSegment } from './segment';
import type { Point, Polyline } from './types';

const PI = Math.PI;

/** Shortest distance from p to the contour, written independently of offset.ts. */
export function distanceTo(p: Point, poly: Polyline): number {
  let best = Infinity;
  forEachSegment(poly, (a, b, bulge) => {
    const arc = arcOf(a, b, bulge);
    if (!arc) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t =
        len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
      best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
      return;
    }
    const ang = Math.atan2(p.y - arc.center.y, p.x - arc.center.x);
    const raw = arc.sweep > 0 ? ang - arc.startAngle : arc.startAngle - ang;
    const delta = ((raw % (2 * PI)) + 2 * PI) % (2 * PI);
    best = Math.min(
      best,
      delta <= Math.abs(arc.sweep)
        ? Math.abs(Math.hypot(p.x - arc.center.x, p.y - arc.center.y) - arc.radius)
        : Math.min(Math.hypot(p.x - a.x, p.y - a.y), Math.hypot(p.x - b.x, p.y - b.y)),
    );
  });
  return best;
}

/** Largest |distance − |d|| over the vertices plus 8 points per line and 32 per arc. */
export function maxDeviation(out: readonly Polyline[], original: Polyline, d: number): number {
  let worst = 0;
  for (const poly of out) {
    forEachSegment(poly, (a, b, bulge) => {
      const pts = arcOf(a, b, bulge)
        ? sampleSegment(a, b, bulge, 32)
        : Array.from({ length: 9 }, (_, i) => ({
            x: a.x + ((b.x - a.x) * i) / 8,
            y: a.y + ((b.y - a.y) * i) / 8,
          }));
      for (const q of pts) worst = Math.max(worst, Math.abs(distanceTo(q, original) - Math.abs(d)));
    });
  }
  return worst;
}
