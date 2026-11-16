/**
 * Single-segment helpers for bulge polylines. A segment runs from p0 to p1; `bulge` = tan(θ/4)
 * where θ is the signed sweep (+ = CCW). |bulge| < MIN_BULGE or a zero-length chord is a line.
 */
import { MIN_BULGE } from './constants';
import type { BBox, Point } from './types';

/** Arc data of a segment, or undefined for a straight line. */
export interface Arc {
  center: Point;
  radius: number;
  /** Angle of p0 seen from the centre, radians. */
  startAngle: number;
  /** Signed sweep θ = 4·atan(bulge), radians; + = CCW. |θ| < 2π. */
  sweep: number;
}

/** True when the segment is an arc (not a line). */
export function isArc(p0: Point, p1: Point, bulge: number): boolean {
  return Math.abs(bulge) >= MIN_BULGE && (p0.x !== p1.x || p0.y !== p1.y);
}

/** Signed sweep angle of a bulge, radians (+ = CCW). */
export function bulgeToSweep(bulge: number): number {
  return 4 * Math.atan(bulge);
}

/** Bulge of a signed sweep angle in radians. */
export function sweepToBulge(sweep: number): number {
  return Math.tan(sweep / 4);
}

/** Centre, radius, start angle and sweep of an arc segment; undefined for a line. */
export function arcOf(p0: Point, p1: Point, bulge: number): Arc | undefined {
  if (!isArc(p0, p1, bulge)) return undefined;
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const chord = Math.hypot(dx, dy);
  // Centre = chord midpoint + (1 − b²)/(4b) · left normal (−dy, dx).
  const k = (1 - bulge * bulge) / (4 * bulge);
  const center = { x: (p0.x + p1.x) / 2 - k * dy, y: (p0.y + p1.y) / 2 + k * dx };
  const radius = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
  return {
    center,
    radius,
    startAngle: Math.atan2(p0.y - center.y, p0.x - center.x),
    sweep: bulgeToSweep(bulge),
  };
}

/** Midpoint of the segment (on the arc for an arc segment). */
export function segmentMidpoint(p0: Point, p1: Point, bulge: number): Point {
  const mx = (p0.x + p1.x) / 2;
  const my = (p0.y + p1.y) / 2;
  if (!isArc(p0, p1, bulge)) return { x: mx, y: my };
  // The sagitta is b·chord/2, on the right of the chord for b > 0: right normal (dy, −dx).
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  return { x: mx + (bulge * dy) / 2, y: my - (bulge * dx) / 2 };
}

/** Length of the segment (arc length for arcs). */
export function segmentLength(p0: Point, p1: Point, bulge: number): number {
  const chord = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  if (!isArc(p0, p1, bulge)) return chord;
  const half = Math.abs(bulgeToSweep(bulge)) / 2;
  return (chord * half) / Math.sin(half);
}

/** θ − sin θ, with a series for small θ to avoid cancellation. */
function thetaMinusSin(theta: number): number {
  if (Math.abs(theta) > 1e-2) return theta - Math.sin(theta);
  const t3 = theta * theta * theta;
  const t2 = theta * theta;
  return (t3 / 6) * (1 - (t2 / 20) * (1 - t2 / 42));
}

/**
 * Signed contribution of the segment to the shoelace area: the chord term (x0·y1 − x1·y0)/2 plus
 * the circular-segment area between chord and arc, r²(θ − sin θ)/2, signed like the bulge.
 */
export function segmentArea(p0: Point, p1: Point, bulge: number): number {
  const chordTerm = (p0.x * p1.y - p1.x * p0.y) / 2;
  if (!isArc(p0, p1, bulge)) return chordTerm;
  const chord = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  const theta = bulgeToSweep(bulge);
  const half = theta / 2;
  // r² = (chord / (2 sin(θ/2)))²; sign of the segment area follows θ.
  const r2 = (chord * chord) / (4 * Math.sin(half) * Math.sin(half));
  return chordTerm + (r2 * thetaMinusSin(theta)) / 2;
}

/** Is `angle` inside the sweep that starts at `start` (radians)? */
function inSweep(angle: number, start: number, sweep: number): boolean {
  const TWO_PI = 2 * Math.PI;
  const raw = sweep > 0 ? angle - start : start - angle;
  const delta = ((raw % TWO_PI) + TWO_PI) % TWO_PI;
  return delta < Math.abs(sweep);
}

/** Bounding box of one segment: endpoints plus the arc's axis extremes inside its sweep. */
export function segmentBBox(p0: Point, p1: Point, bulge: number): BBox {
  const box: BBox = {
    minX: Math.min(p0.x, p1.x),
    minY: Math.min(p0.y, p1.y),
    maxX: Math.max(p0.x, p1.x),
    maxY: Math.max(p0.y, p1.y),
  };
  const arc = arcOf(p0, p1, bulge);
  if (!arc) return box;
  const { center: c, radius: r, startAngle, sweep } = arc;
  if (inSweep(0, startAngle, sweep)) box.maxX = Math.max(box.maxX, c.x + r);
  if (inSweep(Math.PI / 2, startAngle, sweep)) box.maxY = Math.max(box.maxY, c.y + r);
  if (inSweep(Math.PI, startAngle, sweep)) box.minX = Math.min(box.minX, c.x - r);
  if (inSweep(-Math.PI / 2, startAngle, sweep)) box.minY = Math.min(box.minY, c.y - r);
  return box;
}

/**
 * `steps + 1` points along the segment from p0 to p1 (both included). A line gives only its two
 * endpoints. Used for previews and tests.
 */
export function sampleSegment(p0: Point, p1: Point, bulge: number, steps = 16): Point[] {
  const arc = arcOf(p0, p1, bulge);
  if (!arc)
    return [
      { x: p0.x, y: p0.y },
      { x: p1.x, y: p1.y },
    ];
  const { center: c, radius: r, startAngle, sweep } = arc;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = startAngle + (sweep * i) / steps;
    return { x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) };
  });
}
