/**
 * Snap engine (T126, spec §4.4): pulls a pointer position onto nearby geometry. Pure: the editor
 * passes the contours in board millimetres, a tolerance in millimetres (a screen distance divided
 * by the zoom) and the enabled kinds; the result is the kind and the exact point.
 *
 * Kinds are tried in priority order (endpoint, intersection, midpoint, centre, perpendicular,
 * 45°/90° angle, grid); the first kind with a candidate inside the tolerance wins, and inside a
 * kind the nearest candidate wins. Nothing inside the tolerance → `none` and the point unchanged.
 */
import { arcOf, segmentMidpoint, type Arc } from '../geometry/segment';
import type { Point, Vertex } from '../geometry/types';

export type SnapKind =
  'endpoint' | 'intersection' | 'midpoint' | 'centre' | 'perpendicular' | 'angle' | 'grid' | 'none';

/** Priority order: earlier kinds win over later ones when both are within the tolerance. */
export const SNAP_PRIORITY: readonly Exclude<SnapKind, 'none'>[] = [
  'endpoint',
  'intersection',
  'midpoint',
  'centre',
  'perpendicular',
  'angle',
  'grid',
];

export interface SnapContext {
  /** Closed bulge contours to snap to, board mm. */
  contours: readonly (readonly Vertex[])[];
  /** Extra centre points (hole centres). */
  centres?: readonly Point[];
  /** Capture distance, mm (screen tolerance in px divided by the zoom). */
  tolerance: number;
  /** Grid step, mm; undefined = no grid snap. */
  grid?: number;
  /** Start of the current operation (line start, drag anchor): perpendicular and angle lock. */
  from?: Point;
  /** Kinds switched off by the user; everything else is on. */
  disabled?: readonly SnapKind[];
}

export interface SnapResult {
  kind: SnapKind;
  point: Point;
}

interface Seg {
  a: Point;
  b: Point;
  arc: Arc | undefined;
}

const TAU = 2 * Math.PI;

function segments(contours: SnapContext['contours']): Seg[] {
  const out: Seg[] = [];
  for (const c of contours) {
    c.forEach((v, i) => {
      const w = c[(i + 1) % c.length] ?? v;
      if (v.x === w.x && v.y === w.y && c.length > 1 && v.bulge === 0) return;
      out.push({ a: { x: v.x, y: v.y }, b: { x: w.x, y: w.y }, arc: arcOf(v, w, v.bulge) });
    });
  }
  return out;
}

function d(p: Point, q: Point): number {
  return Math.hypot(p.x - q.x, p.y - q.y);
}

/** True when the angle `t` lies on the arc's sweep (inclusive). */
function onArc(arc: Arc, t: number): boolean {
  const rel = arc.sweep >= 0 ? t - arc.startAngle : arc.startAngle - t;
  const norm = ((rel % TAU) + TAU) % TAU;
  return norm <= Math.abs(arc.sweep) + 1e-9 || norm >= TAU - 1e-9;
}

function onArcPoint(arc: Arc, p: Point): boolean {
  return onArc(arc, Math.atan2(p.y - arc.center.y, p.x - arc.center.x));
}

/** Parameter of p's projection on the line a→b (0 at a, 1 at b). */
function projT(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  return l2 === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Distance from p to a segment (line or arc). */
function distToSeg(p: Point, s: Seg): number {
  if (!s.arc) return d(p, lerp(s.a, s.b, Math.max(0, Math.min(1, projT(p, s.a, s.b)))));
  const t = Math.atan2(p.y - s.arc.center.y, p.x - s.arc.center.x);
  if (onArc(s.arc, t)) return Math.abs(d(p, s.arc.center) - s.arc.radius);
  return Math.min(d(p, s.a), d(p, s.b));
}

/** Intersections of two infinite-line / full-circle carriers, filtered to both segments. */
function intersect(s: Seg, u: Seg): Point[] {
  const out: Point[] = [];
  const keep = (p: Point) => {
    const onS = s.arc ? onArcPoint(s.arc, p) : between(p, s);
    const onU = u.arc ? onArcPoint(u.arc, p) : between(p, u);
    if (onS && onU) out.push(p);
  };
  if (!s.arc && !u.arc) {
    const r = { x: s.b.x - s.a.x, y: s.b.y - s.a.y };
    const q = { x: u.b.x - u.a.x, y: u.b.y - u.a.y };
    const den = r.x * q.y - r.y * q.x;
    if (Math.abs(den) < 1e-12) return out;
    const t = ((u.a.x - s.a.x) * q.y - (u.a.y - s.a.y) * q.x) / den;
    keep(lerp(s.a, s.b, t));
    return out;
  }
  if (s.arc && u.arc) {
    for (const p of circleCircle(s.arc, u.arc)) keep(p);
    return out;
  }
  const line = s.arc ? u : s;
  const arc = (s.arc ?? u.arc) as Arc;
  for (const p of lineCircle(line.a, line.b, arc)) keep(p);
  return out;
}

function between(p: Point, s: Seg): boolean {
  const t = projT(p, s.a, s.b);
  return t >= -1e-9 && t <= 1 + 1e-9;
}

function lineCircle(a: Point, b: Point, c: Arc): Point[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const fx = a.x - c.center.x;
  const fy = a.y - c.center.y;
  const A = dx * dx + dy * dy;
  if (A === 0) return [];
  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - c.radius * c.radius;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return [];
  const sq = Math.sqrt(disc);
  return [(-B - sq) / (2 * A), (-B + sq) / (2 * A)].map((t) => lerp(a, b, t));
}

function circleCircle(p: Arc, q: Arc): Point[] {
  const dist = d(p.center, q.center);
  if (dist === 0 || dist > p.radius + q.radius || dist < Math.abs(p.radius - q.radius)) return [];
  const a = (p.radius ** 2 - q.radius ** 2 + dist ** 2) / (2 * dist);
  const h = Math.sqrt(Math.max(0, p.radius ** 2 - a * a));
  const m = lerp(p.center, q.center, a / dist);
  const ox = (-(q.center.y - p.center.y) * h) / dist;
  const oy = ((q.center.x - p.center.x) * h) / dist;
  return [
    { x: m.x + ox, y: m.y + oy },
    { x: m.x - ox, y: m.y - oy },
  ];
}

/** Foot of the perpendicular from `from` onto the segment, if it lies on it. */
function perpendicularFoot(from: Point, s: Seg): Point | undefined {
  if (!s.arc) {
    const t = projT(from, s.a, s.b);
    return t >= 0 && t <= 1 ? lerp(s.a, s.b, t) : undefined;
  }
  const c = s.arc.center;
  const len = d(from, c);
  if (len === 0) return undefined;
  const p = {
    x: c.x + ((from.x - c.x) / len) * s.arc.radius,
    y: c.y + ((from.y - c.y) / len) * s.arc.radius,
  };
  return onArcPoint(s.arc, p) ? p : undefined;
}

/** Nearest point on the 45° rays from `from`. */
function angleLock(p: Point, from: Point): Point | undefined {
  const dx = p.x - from.x;
  const dy = p.y - from.y;
  if (dx === 0 && dy === 0) return undefined;
  const step = Math.PI / 4;
  const ang = Math.round(Math.atan2(dy, dx) / step) * step;
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  // Exact axes: no cos(π/2) dust on the 90° lines.
  const ex = Math.abs(ux) < 1e-12 ? 0 : ux;
  const ey = Math.abs(uy) < 1e-12 ? 0 : uy;
  const t = dx * ex + dy * ey;
  return { x: from.x + ex * t, y: from.y + ey * t };
}

function candidates(kind: Exclude<SnapKind, 'none'>, p: Point, ctx: SnapContext, segs: Seg[]) {
  const tol = ctx.tolerance;
  const near = segs.filter((s) => distToSeg(p, s) <= tol);
  switch (kind) {
    case 'endpoint':
      return segs.map((s) => s.a);
    case 'midpoint':
      return segs.map((s) => segmentMidpoint(s.a, s.b, s.arc ? bulgeOf(s) : 0));
    case 'centre':
      return [...segs.flatMap((s) => (s.arc ? [s.arc.center] : [])), ...(ctx.centres ?? [])];
    case 'intersection': {
      const out: Point[] = [];
      for (let i = 0; i < near.length; i += 1) {
        for (let j = i + 1; j < near.length; j += 1) {
          const s = near[i] as Seg;
          const u = near[j] as Seg;
          // Neighbours of one contour meet at their shared vertex: that is an endpoint.
          for (const x of intersect(s, u)) {
            if (d(x, s.a) > 1e-9 && d(x, s.b) > 1e-9) out.push(x);
          }
        }
      }
      return out;
    }
    case 'perpendicular': {
      const from = ctx.from;
      if (!from) return [];
      return near.flatMap((s) => {
        const f = perpendicularFoot(from, s);
        return f ? [f] : [];
      });
    }
    case 'angle': {
      const a = ctx.from ? angleLock(p, ctx.from) : undefined;
      return a ? [a] : [];
    }
    case 'grid': {
      const g = ctx.grid;
      if (!g || g <= 0) return [];
      return [{ x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g }];
    }
  }
}

function bulgeOf(s: Seg): number {
  return s.arc ? Math.tan(s.arc.sweep / 4) : 0;
}

/** Snaps `point` to the best target within `ctx.tolerance`; see the module comment. */
export function snap(point: Point, ctx: SnapContext): SnapResult {
  const off = new Set(ctx.disabled ?? []);
  if (!(ctx.tolerance > 0)) return { kind: 'none', point: { x: point.x, y: point.y } };
  const segs = segments(ctx.contours);
  for (const kind of SNAP_PRIORITY) {
    if (off.has(kind)) continue;
    let best: Point | undefined;
    let bestD = Infinity;
    for (const c of candidates(kind, point, ctx, segs)) {
      const dist = d(point, c);
      if (dist <= ctx.tolerance && dist < bestD) {
        best = c;
        bestD = dist;
      }
    }
    if (best) return { kind, point: { x: best.x, y: best.y } };
  }
  return { kind: 'none', point: { x: point.x, y: point.y } };
}
