/**
 * Parallel offset of a closed bulge polyline (spec §6.3, T007). Own implementation, approach C of
 * the T007 spike (docs/spikes/T007-offset.md); the method follows CavalierContours:
 *
 * 1. Raw offset: every line is shifted along its normal, every arc keeps its centre and changes its
 *    radius. Neighbouring raw segments are joined by an arc of radius |d| around the original
 *    vertex (round join = the path of the tool centre around a corner). An arc whose radius would
 *    become negative ("collapsed", radius < |d| on the offset side) becomes a straight connector.
 * 2. All self-intersections of the raw offset loop are found and every segment is split at them.
 * 3. A piece is kept only when its sample points are at least |d| − tolerance away from the
 *    original contour; pieces that come too close (they would gouge the part) are dropped.
 * 4. Kept pieces are stitched into closed loops at their shared intersection points; collinear
 *    lines and co-circular arcs are merged again, so arcs come out as arcs (bulges).
 *
 * Limits (stated, tested): input must be one closed, simple (non-self-intersecting) contour. Open
 * polylines and self-intersecting input are rejected. A contour that disappears returns
 * `COLLAPSED`. A shrinking offset that splits into several loops returns all of them with a
 * `SPLIT` warning. Islands / several contours at once (e.g. an outline plus its inners) are not
 * combined here; each contour is offset on its own. Arcs with a radius above 10 km are replaced
 * by lines within EPS / 10 (precision). Intersections use an x-sweep over bounding boxes and the
 * distance check skips far segments by their boxes; worst case is still O(n²) in the segments.
 *
 * Pure: no I/O, clock or randomness. Inputs are never mutated.
 */
import { EPS } from './constants';
import { orientation, signedArea } from './polyline';
import { arcOf, segmentBBox, sweepToBulge } from './segment';
import type { Orientation, Point, Polyline, Vertex } from './types';

/** Why an offset could not be produced. */
export type OffsetFailure =
  'INVALID_DISTANCE' | 'NOT_CLOSED' | 'DEGENERATE' | 'SELF_INTERSECTING' | 'COLLAPSED';

/** Non-fatal findings: the path is valid but the caller should tell the user. */
export type OffsetWarning =
  /** An arc's radius is smaller than |d| on the offset side: that corner cannot be cut exactly. */
  | 'ARC_COLLAPSED'
  /** The shrinking offset split into several separate loops. */
  | 'SPLIT';

export type OffsetResult =
  | { ok: true; polylines: Polyline[]; warnings: OffsetWarning[] }
  | { ok: false; reason: OffsetFailure; message: string };

const TWO_PI = 2 * Math.PI;
/** Points closer than this are the same node when splitting and stitching (well below EPS). */
const NODE_TOL = EPS / 100;
/**
 * Piece ends closer than this are joined when stitching. Larger than NODE_TOL on purpose: a split
 * point within NODE_TOL of a segment end does not split it, which can leave gaps of about NODE_TOL
 * between pieces that belong together (tiny join arcs at almost straight corners). Far below EPS.
 */
const STITCH_TOL = 10 * NODE_TOL;
/**
 * A piece is valid when every sample is at least |d| − tolerance from the original contour. Points
 * of true offset pieces are |d| away up to float rounding, so the tolerance is relative to the size
 * of the coordinates (1e-9 of it, at least 1e-9 mm); a looser one would keep pieces of tiny
 * overlaps at almost straight concave corners.
 */
const VALID_REL_TOL = 1e-9;
/**
 * Arcs with a larger radius (mm, 10 km) are replaced by lines whose distance from the arc is at most
 * FLAT_TOL. Circle arithmetic (centre ± radius, √(r² − h²)) loses precision on huge circles; a
 * near-flat DXF bulge would otherwise break the intersection step. No real part has such an arc
 * except as noise.
 */
const MAX_ARC_RADIUS = 1e7;
/** Deviation allowed when a huge-radius arc is replaced by lines (EPS / 10). */
const FLAT_TOL = EPS / 10;

interface LineSeg {
  kind: 'line';
  p0: Point;
  p1: Point;
}

interface ArcSeg {
  kind: 'arc';
  p0: Point;
  p1: Point;
  c: Point;
  r: number;
  /** Angle of p0 seen from c. */
  a0: number;
  /** Signed sweep, + = CCW, 0 < |sweep| < 2π. */
  sweep: number;
}

type Seg = LineSeg | ArcSeg;

const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
const same = (a: Point, b: Point, tol = NODE_TOL) => dist(a, b) <= tol;

function toSeg(p0: Point, p1: Point, bulge: number): Seg {
  const arc = arcOf(p0, p1, bulge);
  if (!arc) return { kind: 'line', p0, p1 };
  return {
    kind: 'arc',
    p0,
    p1,
    c: arc.center,
    r: arc.radius,
    a0: arc.startAngle,
    sweep: arc.sweep,
  };
}

function makeArc(c: Point, r: number, p0: Point, p1: Point, sweep: number): ArcSeg {
  return { kind: 'arc', p0, p1, c, r, a0: Math.atan2(p0.y - c.y, p0.x - c.x), sweep };
}

function segLength(s: Seg): number {
  return s.kind === 'line' ? dist(s.p0, s.p1) : s.r * Math.abs(s.sweep);
}

/** Point at parameter t ∈ [0, 1] (arc: fraction of the sweep). */
function pointAt(s: Seg, t: number): Point {
  if (s.kind === 'line')
    return { x: s.p0.x + (s.p1.x - s.p0.x) * t, y: s.p0.y + (s.p1.y - s.p0.y) * t };
  const a = s.a0 + s.sweep * t;
  return { x: s.c.x + s.r * Math.cos(a), y: s.c.y + s.r * Math.sin(a) };
}

/** Parameter of a point assumed to lie on the segment (or its circle / line). */
function paramOf(s: Seg, p: Point): number {
  if (s.kind === 'line') {
    const dx = s.p1.x - s.p0.x;
    const dy = s.p1.y - s.p0.y;
    return ((p.x - s.p0.x) * dx + (p.y - s.p0.y) * dy) / (dx * dx + dy * dy);
  }
  const a = Math.atan2(p.y - s.c.y, p.x - s.c.x);
  const raw = s.sweep > 0 ? a - s.a0 : s.a0 - a;
  const delta = ((raw % TWO_PI) + TWO_PI) % TWO_PI; // [0, 2π) in the sweep direction
  const t = delta / Math.abs(s.sweep);
  // just before the start reads as ~2π: map it to a small negative parameter
  const tNeg = (delta - TWO_PI) / Math.abs(s.sweep);
  return t > 1 && Math.abs(tNeg) < t - 1 ? tNeg : t;
}

/** Sub-segment between two points on it (given in path order). */
function subSeg(s: Seg, p0: Point, p1: Point, t0: number, t1: number): Seg {
  if (s.kind === 'line') return { kind: 'line', p0, p1 };
  return {
    kind: 'arc',
    p0,
    p1,
    c: s.c,
    r: s.r,
    a0: s.a0 + s.sweep * t0,
    sweep: s.sweep * (t1 - t0),
  };
}

/** Shortest distance from p to the segment. */
function distToSeg(p: Point, s: Seg): number {
  if (s.kind === 'line') {
    const t = Math.min(1, Math.max(0, paramOf(s, p)));
    return dist(p, pointAt(s, t));
  }
  const t = paramOf(s, p);
  if (t >= 0 && t <= 1) return Math.abs(dist(p, s.c) - s.r);
  return Math.min(dist(p, s.p0), dist(p, s.p1));
}

/** Tolerance in parameter space that corresponds to NODE_TOL in length. */
function paramTol(s: Seg): number {
  const len = segLength(s);
  return len > 0 ? NODE_TOL / len : 0;
}

function onSeg(s: Seg, p: Point): boolean {
  const t = paramOf(s, p);
  const tol = paramTol(s);
  return t >= -tol && t <= 1 + tol;
}

/** Points where the full circle / infinite line of each segment meet, filtered to both segments. */
function intersect(a: Seg, b: Seg): Point[] {
  let candidates: Point[];
  if (a.kind === 'line' && b.kind === 'line') candidates = lineLine(a, b);
  else if (a.kind === 'line' && b.kind === 'arc') candidates = lineCircle(a, b);
  else if (a.kind === 'arc' && b.kind === 'line') candidates = lineCircle(b, a);
  else candidates = circleCircle(a as ArcSeg, b as ArcSeg);
  return candidates.filter((p) => onSeg(a, p) && onSeg(b, p));
}

function lineLine(a: LineSeg, b: LineSeg): Point[] {
  const rx = a.p1.x - a.p0.x;
  const ry = a.p1.y - a.p0.y;
  const sx = b.p1.x - b.p0.x;
  const sy = b.p1.y - b.p0.y;
  const den = rx * sy - ry * sx;
  const qx = b.p0.x - a.p0.x;
  const qy = b.p0.y - a.p0.y;
  const lenA = Math.hypot(rx, ry);
  const lenB = Math.hypot(sx, sy);
  if (Math.abs(den) <= 1e-12 * lenA * lenB) {
    // parallel: collinear overlaps are reported by their end points
    const offLine = Math.abs(qx * ry - qy * rx) / lenA;
    if (offLine > NODE_TOL) return [];
    return [a.p0, a.p1, b.p0, b.p1];
  }
  const t = (qx * sy - qy * sx) / den;
  return [{ x: a.p0.x + t * rx, y: a.p0.y + t * ry }];
}

function lineCircle(l: LineSeg, c: ArcSeg): Point[] {
  const dx = l.p1.x - l.p0.x;
  const dy = l.p1.y - l.p0.y;
  const len = Math.hypot(dx, dy);
  const ux = dx / len;
  const uy = dy / len;
  // foot of the perpendicular from the centre
  const t = (c.c.x - l.p0.x) * ux + (c.c.y - l.p0.y) * uy;
  const fx = l.p0.x + t * ux;
  const fy = l.p0.y + t * uy;
  const h = Math.hypot(c.c.x - fx, c.c.y - fy);
  if (h > c.r + NODE_TOL) return [];
  if (h >= c.r) return [{ x: fx, y: fy }]; // tangent (or just missing it)
  // no tangent snapping inside: a shallow crossing has its two points far apart (√(2rδ))
  const k = Math.sqrt((c.r - h) * (c.r + h));
  return [
    { x: fx - k * ux, y: fy - k * uy },
    { x: fx + k * ux, y: fy + k * uy },
  ];
}

function circleCircle(a: ArcSeg, b: ArcSeg): Point[] {
  const dx = b.c.x - a.c.x;
  const dy = b.c.y - a.c.y;
  const dd = Math.hypot(dx, dy);
  if (dd <= NODE_TOL && Math.abs(a.r - b.r) <= NODE_TOL) {
    // same circle: overlaps are reported by their end points
    return [a.p0, a.p1, b.p0, b.p1];
  }
  if (dd <= NODE_TOL) return [];
  if (dd > a.r + b.r + NODE_TOL || dd < Math.abs(a.r - b.r) - NODE_TOL) return [];
  const x = (dd * dd + a.r * a.r - b.r * b.r) / (2 * dd);
  const h2 = a.r * a.r - x * x;
  const ux = dx / dd;
  const uy = dy / dd;
  const mx = a.c.x + x * ux;
  const my = a.c.y + x * uy;
  if (h2 <= 0) return [{ x: mx, y: my }]; // tangent (or just missing it)
  const h = Math.sqrt(h2);
  return [
    { x: mx - h * uy, y: my + h * ux },
    { x: mx + h * uy, y: my - h * ux },
  ];
}

/** Segments of a closed polyline, dropping zero-length ones (duplicate vertices). */
function segmentsOf(vs: readonly Vertex[]): Seg[] {
  const segs: Seg[] = [];
  const n = vs.length;
  for (let i = 0; i < n; i++) {
    const a = vs[i] as Vertex;
    const b = vs[(i + 1) % n] as Vertex;
    if (same(a, b, EPS)) continue;
    const seg = toSeg(a, b, a.bulge);
    if (seg.kind === 'arc' && seg.r > MAX_ARC_RADIUS) segs.push(...flatten(seg));
    else segs.push(seg);
  }
  return segs;
}

/** Lines through points of the arc, each within FLAT_TOL of it. */
function flatten(s: ArcSeg): LineSeg[] {
  const step = 2 * Math.acos(1 - FLAT_TOL / s.r); // sweep of one chord with sagitta FLAT_TOL
  const count = Math.max(1, Math.ceil(Math.abs(s.sweep) / step));
  const out: LineSeg[] = [];
  let prev = s.p0;
  for (let k = 1; k <= count; k++) {
    const next = k === count ? s.p1 : pointAt(s, k / count);
    out.push({ kind: 'line', p0: prev, p1: next });
    prev = next;
  }
  return out;
}

interface BoxedSeg {
  seg: Seg;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function boxed(seg: Seg): BoxedSeg {
  const b =
    seg.kind === 'arc'
      ? segmentBBox(seg.p0, seg.p1, sweepToBulge(seg.sweep))
      : {
          minX: Math.min(seg.p0.x, seg.p1.x),
          minY: Math.min(seg.p0.y, seg.p1.y),
          maxX: Math.max(seg.p0.x, seg.p1.x),
          maxY: Math.max(seg.p0.y, seg.p1.y),
        };
  return { seg, ...b };
}

function boxesTouch(a: BoxedSeg, b: BoxedSeg): boolean {
  return (
    a.minX <= b.maxX + NODE_TOL &&
    b.minX <= a.maxX + NODE_TOL &&
    a.minY <= b.maxY + NODE_TOL &&
    b.minY <= a.maxY + NODE_TOL
  );
}

/**
 * Intersections of a closed loop of segments with itself, as split points per segment. The shared
 * end point of neighbouring segments is not an intersection.
 */
function selfIntersections(segs: readonly Seg[]): Point[][] {
  const n = segs.length;
  const splits: Point[][] = segs.map(() => []);
  const boxes = segs.map(boxed);
  // sweep along x: only pairs whose x ranges overlap are tested
  const order = boxes
    .map((_, i) => i)
    .sort((p, q) => (boxes[p] as BoxedSeg).minX - (boxes[q] as BoxedSeg).minX);
  for (let ka = 0; ka < n; ka++) {
    const oa = order[ka] as number;
    const maxX = (boxes[oa] as BoxedSeg).maxX + NODE_TOL;
    for (let kb = ka + 1; kb < n && (boxes[order[kb] as number] as BoxedSeg).minX <= maxX; kb++) {
      const ob = order[kb] as number;
      const i = Math.min(oa, ob);
      const j = Math.max(oa, ob);
      const bi = boxes[i] as BoxedSeg;
      const bj = boxes[j] as BoxedSeg;
      if (!boxesTouch(bi, bj)) continue;
      const a = bi.seg;
      const b = bj.seg;
      const next = j === i + 1;
      const wrap = i === 0 && j === n - 1;
      for (const p of intersect(a, b)) {
        if (next && same(p, a.p1) && same(p, b.p0)) continue;
        if (wrap && same(p, a.p0) && same(p, b.p1)) continue;
        if (n === 2 && same(p, a.p0) && same(p, b.p1)) continue;
        (splits[i] as Point[]).push(p);
        (splits[j] as Point[]).push(p);
      }
    }
  }
  return splits;
}

/** Does the simple-contour precondition fail? Any crossing or touching of non-neighbours. */
function isSelfIntersecting(segs: readonly Seg[]): boolean {
  return selfIntersections(segs).some((pts) => pts.length > 0);
}

/** Raw offset segment (right of travel by d) or a collapse marker. */
interface RawOffset {
  seg: Seg | undefined;
  start: Point;
  end: Point;
  collapsed: boolean;
}

function rawOffset(s: Seg, d: number): RawOffset {
  if (s.kind === 'line') {
    const len = dist(s.p0, s.p1);
    const nx = (s.p1.y - s.p0.y) / len;
    const ny = -(s.p1.x - s.p0.x) / len;
    const start = { x: s.p0.x + d * nx, y: s.p0.y + d * ny };
    const end = { x: s.p1.x + d * nx, y: s.p1.y + d * ny };
    return { seg: { kind: 'line', p0: start, p1: end }, start, end, collapsed: false };
  }
  // the right side of a CCW arc is away from its centre, of a CW arc towards it
  const r2 = s.sweep > 0 ? s.r + d : s.r - d;
  const k = r2 / s.r;
  const q0 = { x: s.c.x + (s.p0.x - s.c.x) * k, y: s.c.y + (s.p0.y - s.c.y) * k };
  const q1 = { x: s.c.x + (s.p1.x - s.c.x) * k, y: s.c.y + (s.p1.y - s.c.y) * k };
  if (r2 > NODE_TOL)
    return { seg: { ...s, p0: q0, p1: q1, r: r2 }, start: q0, end: q1, collapsed: false };
  // radius exactly |d|: the arc shrinks to its centre point (the tool just fits)
  if (r2 >= -NODE_TOL) return { seg: undefined, start: s.c, end: s.c, collapsed: false };
  // collapsed: keep the loop connected with a straight connector; it is trimmed away later
  const seg: Seg | undefined = same(q0, q1) ? undefined : { kind: 'line', p0: q0, p1: q1 };
  return { seg, start: q0, end: q1, collapsed: true };
}

/** Round join around the original vertex v from `from` to `to` (both at |d| from v). */
function joinArc(v: Point, from: Point, to: Point, r: number): Seg {
  const a0 = Math.atan2(from.y - v.y, from.x - v.x);
  const a1 = Math.atan2(to.y - v.y, to.x - v.x);
  let sweep = a1 - a0;
  while (sweep > Math.PI) sweep -= TWO_PI;
  while (sweep <= -Math.PI) sweep += TWO_PI;
  return makeArc(v, r, from, to, sweep);
}

/** Splits every segment at its split points; returns the pieces in path order. */
function splitAll(segs: readonly Seg[], splits: readonly Point[][]): Seg[] {
  const pieces: Seg[] = [];
  segs.forEach((s, i) => {
    const tol = paramTol(s);
    const cuts = (splits[i] as Point[])
      .map((p) => ({ p, t: paramOf(s, p) }))
      .filter(({ t }) => t > tol && t < 1 - tol)
      .sort((a, b) => a.t - b.t);
    let prev = { p: s.p0, t: 0 };
    for (const cut of [...cuts, { p: s.p1, t: 1 }]) {
      if (cut.t - prev.t > tol && !same(prev.p, cut.p)) {
        pieces.push(subSeg(s, prev.p, cut.p, prev.t, cut.t));
        prev = cut;
      }
    }
  });
  return pieces;
}

/** Is p at least `limit` away from every original segment? Bounding boxes skip far segments. */
function isFarFrom(p: Point, original: readonly BoxedSeg[], limit: number): boolean {
  for (const b of original) {
    const dx = Math.max(b.minX - p.x, 0, p.x - b.maxX);
    const dy = Math.max(b.minY - p.y, 0, p.y - b.maxY);
    if (dx >= limit || dy >= limit || dx * dx + dy * dy >= limit * limit) continue;
    if (distToSeg(p, b.seg) < limit) return false;
  }
  return true;
}

const SAMPLES = [0.25, 0.5, 0.75];

function isValidPiece(piece: Seg, original: readonly BoxedSeg[], limit: number): boolean {
  return SAMPLES.every((t) => isFarFrom(pointAt(piece, t), original, limit));
}

/**
 * Joins pieces into closed loops at shared end points. At a node with several outgoing pieces the
 * next one along the raw path is tried first; a dead end backtracks to the last such choice.
 * Pieces that cannot be part of any closed loop are dropped.
 */
function stitch(pieces: readonly Seg[]): Seg[][] {
  const n = pieces.length;
  const used = new Array<boolean>(n).fill(false);
  const loops: Seg[][] = [];
  const candidates = (cur: number, inPath: ReadonlySet<number>): number[] => {
    const end = (pieces[cur] as Seg).p1;
    const out: number[] = [];
    for (let k = 1; k < n; k++) {
      const idx = (cur + k) % n;
      if (!used[idx] && !inPath.has(idx) && same((pieces[idx] as Seg).p0, end, STITCH_TOL))
        out.push(idx);
    }
    return out;
  };
  for (let start = 0; start < n; start++) {
    if (used[start]) continue;
    const first = (pieces[start] as Seg).p0;
    const path = [start];
    const inPath = new Set(path);
    const options = [candidates(start, inPath)];
    let budget = 4 * n + 64; // backtracking is rare; never let it explode
    let closed = false;
    while (path.length > 0 && budget-- > 0) {
      const cur = path[path.length - 1] as number;
      if (path.length > 1 && same((pieces[cur] as Seg).p1, first, STITCH_TOL)) {
        closed = true;
        break;
      }
      const next = (options[options.length - 1] as number[]).shift();
      if (next === undefined) {
        path.pop();
        inPath.delete(cur);
        options.pop();
        continue;
      }
      path.push(next);
      inPath.add(next);
      options.push(candidates(next, inPath));
    }
    used[start] = true;
    if (!closed) continue;
    for (const idx of path) used[idx] = true;
    loops.push(path.map((idx) => pieces[idx] as Seg));
  }
  return loops;
}

/** Merges neighbouring collinear lines and co-circular arcs (pieces split at dropped nodes). */
function mergeLoop(loop: readonly Seg[]): Seg[] {
  const canMerge = (a: Seg, b: Seg): boolean => {
    if (a.kind === 'line' && b.kind === 'line') {
      const ax = a.p1.x - a.p0.x;
      const ay = a.p1.y - a.p0.y;
      const bx = b.p1.x - b.p0.x;
      const by = b.p1.y - b.p0.y;
      const cross = ax * by - ay * bx;
      const dot = ax * bx + ay * by;
      return dot > 0 && Math.abs(cross) <= 1e-12 * Math.hypot(ax, ay) * Math.hypot(bx, by) * 1e3;
    }
    if (a.kind === 'arc' && b.kind === 'arc') {
      return (
        same(a.c, b.c) &&
        Math.abs(a.r - b.r) <= NODE_TOL &&
        Math.sign(a.sweep) === Math.sign(b.sweep) &&
        Math.abs(a.sweep + b.sweep) < TWO_PI - 1e-6 // keep a full circle as ≥ 2 arcs
      );
    }
    return false;
  };
  const merge = (a: Seg, b: Seg): Seg =>
    a.kind === 'line'
      ? { kind: 'line', p0: a.p0, p1: b.p1 }
      : { ...a, p1: b.p1, sweep: a.sweep + (b as ArcSeg).sweep };

  const out: Seg[] = [];
  for (const s of loop) {
    const last = out[out.length - 1];
    if (last && canMerge(last, s)) out[out.length - 1] = merge(last, s);
    else out.push(s);
  }
  // wrap-around: the last piece may continue into the first
  while (out.length > 2) {
    const last = out[out.length - 1] as Seg;
    const first = out[0] as Seg;
    if (!canMerge(last, first)) break;
    out.pop();
    out[0] = merge(last, first);
  }
  return out;
}

function toPolyline(loop: readonly Seg[]): Polyline {
  return {
    closed: true,
    vertices: loop.map((s) => ({
      x: s.p0.x,
      y: s.p0.y,
      bulge: s.kind === 'arc' ? sweepToBulge(s.sweep) : 0,
    })),
  };
}

/**
 * Offsets a closed, simple bulge polyline by `d` millimetres to the **right of its direction of
 * travel** (d < 0: to the left). With the stored directions (outer CCW, inner CW, spec §6.1)
 * `offset(contour, toolRadius)` is the tool-centre path for both: outward for an outer contour,
 * into the opening for an inner contour.
 *
 * Every point of the result is |d| from the input (round joins at convex corners, trimmed at
 * concave ones), arcs stay arcs, the result is closed and has the input's direction.
 */
export function offset(poly: Polyline, d: number): OffsetResult {
  if (!Number.isFinite(d))
    return { ok: false, reason: 'INVALID_DISTANCE', message: 'Offset distance must be finite.' };
  if (!poly.closed)
    return { ok: false, reason: 'NOT_CLOSED', message: 'Only closed contours can be offset.' };

  const original = segmentsOf(poly.vertices);
  const dir: Orientation = original.length >= 2 ? orientation(poly) : 'none';
  if (original.length >= 2 && isSelfIntersecting(original))
    return {
      ok: false,
      reason: 'SELF_INTERSECTING',
      message: 'Contour crosses or touches itself.',
    };
  if (dir === 'none')
    return {
      ok: false,
      reason: 'DEGENERATE',
      message: 'Contour has no area (fewer than 2 segments or zero area).',
    };

  if (Math.abs(d) < EPS)
    return {
      ok: true,
      polylines: [{ closed: true, vertices: poly.vertices.map((v) => ({ ...v })) }],
      warnings: [],
    };

  const absD = Math.abs(d);
  const warnings = new Set<OffsetWarning>();

  // 1. raw offset loop with round joins
  const raw: Seg[] = [];
  const offs = original.map((s) => rawOffset(s, d));
  if (offs.some((o) => o.collapsed)) warnings.add('ARC_COLLAPSED');
  original.forEach((s, i) => {
    const o = offs[i] as RawOffset;
    if (o.seg) raw.push(o.seg);
    const nextStart = (offs[(i + 1) % offs.length] as RawOffset).start;
    if (!same(o.end, nextStart)) raw.push(joinArc(s.p1, o.end, nextStart, absD));
  });

  // 2. split at self-intersections, 3. keep pieces that keep their distance, 4. stitch
  let scale = absD;
  for (const v of poly.vertices) scale = Math.max(scale, Math.abs(v.x), Math.abs(v.y));
  const validTol = VALID_REL_TOL * Math.max(1, scale);
  const originalBoxes = original.map(boxed);
  const pieces = splitAll(raw, selfIntersections(raw)).filter((p) =>
    isValidPiece(p, originalBoxes, absD - validTol),
  );
  const loops = stitch(pieces)
    .map(mergeLoop)
    .map(toPolyline)
    .filter((p) => orientation(p) === dir && Math.abs(signedArea(p)) > EPS * EPS);

  if (loops.length === 0)
    return { ok: false, reason: 'COLLAPSED', message: `Offset by ${d} mm leaves no contour.` };
  if (loops.length > 1) warnings.add('SPLIT');
  return { ok: true, polylines: loops, warnings: [...warnings] };
}
