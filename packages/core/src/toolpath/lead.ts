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
import {
  arcOf,
  sampleSegment,
  segmentBBox,
  segmentLength,
  sweepToBulge,
} from '../geometry/segment';
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

/** Spacing of the lead samples, mm. */
export const LEAD_SAMPLE_STEP = 0.05;

/** Points along a segment, at most LEAD_SAMPLE_STEP apart (both ends included). */
export function samplePath(s: PathSeg): Point[] {
  const n = Math.max(1, Math.ceil(segmentLength(s.p0, s.p1, s.bulge) / LEAD_SAMPLE_STEP));
  if (arcOf(s.p0, s.p1, s.bulge)) return sampleSegment(s.p0, s.p1, s.bulge, n);
  return Array.from({ length: n + 1 }, (_, i) => ({
    x: s.p0.x + ((s.p1.x - s.p0.x) * i) / n,
    y: s.p0.y + ((s.p1.y - s.p0.y) * i) / n,
  }));
}

/**
 * True when the leads stay inside `bounds` (exact, arc-aware box) and clear of the parts.
 * Neighbours: the distance to an outline is 1-Lipschitz, so with samples at most h apart every
 * point between two samples is at least (sample distance − h/2) away; requiring
 * toolRadius + h/2 at the samples makes the check hold for the whole lead, not only the samples.
 * Own part: the lead ends on the contour at exactly the tool radius, so the margin cannot be
 * added there; the own part is checked at the samples (tool radius − EPS).
 */
export function leadsClear(
  leads: Leads,
  own: Obstacle,
  neighbours: readonly Obstacle[],
  toolRadius: number,
  bounds: BBox,
): boolean {
  for (const seg of [leads.leadIn, leads.leadOut]) {
    if (!seg) continue;
    const box = segmentBBox(seg.p0, seg.p1, seg.bulge);
    if (
      box.minX < bounds.minX - EPS ||
      box.maxX > bounds.maxX + EPS ||
      box.minY < bounds.minY - EPS ||
      box.maxY > bounds.maxY + EPS
    ) {
      return false;
    }
    for (const q of samplePath(seg)) {
      if (!clearOf(q, own, toolRadius)) return false;
      if (!neighbours.every((o) => clearOf(q, o, toolRadius + LEAD_SAMPLE_STEP / 2))) return false;
    }
  }
  return true;
}
