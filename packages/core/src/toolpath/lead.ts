/**
 * Lead-in / lead-out geometry and the clearance check (spec §6.3, D-021). Pure.
 *
 * At the start point P of the tool-centre loop (travel tangent t, outward normal n = away from
 * the part):
 * - arc lead: a quarter arc of radius r tangent to the contour at P. Lead-in starts at
 *   P + r·n − r·t, lead-out ends at P + r·n + r·t.
 * - line lead: a straight line at 45° to the contour, length r. Lead-in starts at
 *   P + r·(n − t)/√2, lead-out ends at P + r·(n + t)/√2.
 * Both stay on the waste side of an outer contour.
 */
import { EPS } from '../geometry/constants';
import { forEachSegment } from '../geometry/polyline';
import { arcOf, sampleSegment, segmentBBox, sweepToBulge } from '../geometry/segment';
import type { BBox, Point, Polyline } from '../geometry/types';
import type { PathSeg } from './path';
import type { LeadType } from './types';

export interface Leads {
  leadIn: PathSeg | null;
  leadOut: PathSeg | null;
}

/** Lead segments of length/radius `len` at P (`len` ≤ 0 or type `none` → no leads). */
export function leadSegments(
  p: Point,
  tIn: Point,
  tOut: Point,
  travel: 'cw' | 'ccw',
  type: LeadType,
  len: number,
): Leads {
  if (type === 'none' || len <= 0) return { leadIn: null, leadOut: null };
  const s = travel === 'ccw' ? 1 : -1;
  // Outward normal: right of travel for CCW (the part is on the left), left for CW.
  const nIn = { x: s * tIn.y, y: -s * tIn.x };
  const nOut = { x: s * tOut.y, y: -s * tOut.x };
  if (type === 'arc') {
    const bulge = sweepToBulge((-s * Math.PI) / 2);
    const start = { x: p.x + len * (nIn.x - tIn.x), y: p.y + len * (nIn.y - tIn.y) };
    const end = { x: p.x + len * (nOut.x + tOut.x), y: p.y + len * (nOut.y + tOut.y) };
    return {
      leadIn: { p0: start, p1: { ...p }, bulge },
      leadOut: { p0: { ...p }, p1: end, bulge },
    };
  }
  const k = len / Math.SQRT2;
  const start = { x: p.x + k * (nIn.x - tIn.x), y: p.y + k * (nIn.y - tIn.y) };
  const end = { x: p.x + k * (nOut.x + tOut.x), y: p.y + k * (nOut.y + tOut.y) };
  return {
    leadIn: { p0: start, p1: { ...p }, bulge: 0 },
    leadOut: { p0: { ...p }, p1: end, bulge: 0 },
  };
}

/** A part outline prepared for clearance queries. */
export interface Obstacle {
  outline: Polyline;
  box: BBox;
  /** Flattened outline (arcs sampled) for the inside test. */
  polygon: Point[];
}

export function obstacle(outline: Polyline): Obstacle {
  const polygon: Point[] = [];
  let box: BBox | null = null;
  forEachSegment(outline, (a, b, bulge) => {
    const pts = sampleSegment(a, b, bulge, 64);
    pts.pop();
    polygon.push(...pts);
    const sb = segmentBBox(a, b, bulge);
    box = box
      ? {
          minX: Math.min(box.minX, sb.minX),
          minY: Math.min(box.minY, sb.minY),
          maxX: Math.max(box.maxX, sb.maxX),
          maxY: Math.max(box.maxY, sb.maxY),
        }
      : sb;
  });
  return { outline, polygon, box: box ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 } };
}

/** Shortest distance from p to a closed bulge polyline (lines and arcs exactly). */
export function distanceToOutline(p: Point, outline: Polyline): number {
  let best = Infinity;
  forEachSegment(outline, (a, b, bulge) => {
    const arc = arcOf(a, b, bulge);
    if (!arc) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const l2 = dx * dx + dy * dy;
      const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
      best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
      return;
    }
    const ang = Math.atan2(p.y - arc.center.y, p.x - arc.center.x);
    const twoPi = 2 * Math.PI;
    const raw = arc.sweep > 0 ? ang - arc.startAngle : arc.startAngle - ang;
    const delta = ((raw % twoPi) + twoPi) % twoPi;
    const d =
      delta <= Math.abs(arc.sweep)
        ? Math.abs(Math.hypot(p.x - arc.center.x, p.y - arc.center.y) - arc.radius)
        : Math.min(Math.hypot(p.x - a.x, p.y - a.y), Math.hypot(p.x - b.x, p.y - b.y));
    best = Math.min(best, d);
  });
  return best;
}

/** Even-odd ray cast against the flattened outline. */
export function insidePolygon(p: Point, poly: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i] as Point;
    const b = poly[j] as Point;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Is a tool centre at p clear of the obstacle, i.e. outside it and at least `toolRadius` from its
 * outline (EPS slack)?
 */
export function clearOf(p: Point, o: Obstacle, toolRadius: number): boolean {
  const { box } = o;
  if (
    p.x < box.minX - toolRadius - EPS ||
    p.x > box.maxX + toolRadius + EPS ||
    p.y < box.minY - toolRadius - EPS ||
    p.y > box.maxY + toolRadius + EPS
  ) {
    return true;
  }
  if (insidePolygon(p, o.polygon)) return false;
  return distanceToOutline(p, o.outline) >= toolRadius - EPS;
}

/** Sample points of a segment (17 on lines and arcs) for the clearance check. */
export function samplePath(s: PathSeg): Point[] {
  if (arcOf(s.p0, s.p1, s.bulge)) return sampleSegment(s.p0, s.p1, s.bulge, 16);
  return Array.from({ length: 17 }, (_, i) => ({
    x: s.p0.x + ((s.p1.x - s.p0.x) * i) / 16,
    y: s.p0.y + ((s.p1.y - s.p0.y) * i) / 16,
  }));
}

/**
 * True when every sampled tool-centre point of the leads is inside `bounds` and clear of all
 * obstacles (the own part and its neighbours on the sheet).
 */
export function leadsClear(
  leads: Leads,
  obstacles: readonly Obstacle[],
  toolRadius: number,
  bounds: BBox,
): boolean {
  for (const seg of [leads.leadIn, leads.leadOut]) {
    if (!seg) continue;
    for (const q of samplePath(seg)) {
      if (
        q.x < bounds.minX - EPS ||
        q.x > bounds.maxX + EPS ||
        q.y < bounds.minY - EPS ||
        q.y > bounds.maxY + EPS
      ) {
        return false;
      }
      if (!obstacles.every((o) => clearOf(q, o, toolRadius))) return false;
    }
  }
  return true;
}
