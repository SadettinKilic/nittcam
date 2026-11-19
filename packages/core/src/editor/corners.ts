/**
 * Corner geometry of a part outline (T131, T132, spec §4.4): fillets, the inner-corner rule and
 * dogbone / T-bone overcuts. Pure helpers on a CCW outline in the part frame; the commands in
 * `commands/part/corners.ts` and the properties panel both use them.
 */
import { EPS } from '../geometry/constants';
import { arcOf, bulgeToSweep, sweepToBulge } from '../geometry/segment';
import type { Point, Vertex } from '../geometry/types';
import { bulgeThrough, tidy } from './draw';
import { checkOutline, type OutlineEditError } from './edit';

/** Turns smaller than this (radians) are no corner at all (collinear segments). */
const MIN_TURN = 1e-6;

function at(vs: readonly Vertex[], i: number): Vertex {
  const n = vs.length;
  return vs[((i % n) + n) % n] as Vertex;
}

function unit(a: Point, b: Point): Point {
  const l = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
}

function rotateDir(d: Point, rad: number): Point {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: d.x * c - d.y * s, y: d.x * s + d.y * c };
}

/** Travel direction at the start (`end` false) or end of segment a → b (arc-aware). */
function tangent(a: Vertex, b: Point, end: boolean): Point {
  const d = unit(a, b);
  if (!arcOf(a, b, a.bulge)) return d;
  const half = bulgeToSweep(a.bulge) / 2;
  return rotateDir(d, end ? half : -half);
}

/**
 * Signed turn at vertex `i` (radians, + = left / convex on a CCW outline, − = right / concave):
 * the angle from the incoming segment's end direction to the outgoing segment's start direction.
 */
export function cornerTurn(vs: readonly Vertex[], i: number): number {
  const prev = at(vs, i - 1);
  const v = at(vs, i);
  const next = at(vs, i + 1);
  const din = tangent(prev, v, true);
  const dout = tangent(v, next, false);
  return Math.atan2(din.x * dout.y - din.y * dout.x, din.x * dout.x + din.y * dout.y);
}

/** Can vertex `i` be filleted: two straight segments meeting at a real corner? */
export function isSharpLineCorner(vs: readonly Vertex[], i: number): boolean {
  if (vs.length < 3) return false;
  const prev = at(vs, i - 1);
  const v = at(vs, i);
  if (arcOf(prev, v, prev.bulge) || arcOf(v, at(vs, i + 1), v.bulge)) return false;
  const turn = Math.abs(cornerTurn(vs, i));
  return turn > MIN_TURN && turn < Math.PI - MIN_TURN;
}

export interface FilletResult {
  vertices: Vertex[];
  /** The radius each corner got, in the order of `corners` (smaller than asked when clamped). */
  radii: number[];
  /** True when at least one radius was clamped to the neighbouring segment lengths. */
  clamped: boolean;
}

export type FilletOutcome =
  ({ ok: true } & FilletResult) | { ok: false; error: OutlineEditError | 'corner' };

/**
 * Rounds the given corners (vertex indices) with radius `r` (spec §4.4 "köşe yuvarlama"): each
 * sharp corner between two straight segments becomes a tangent arc. The radius is clamped so the
 * arc fits on both neighbouring segments (a segment shared by two filleted corners gives each half
 * its length); `clamped` then reports it. A concave corner gets a concave arc (material is added).
 */
export function filletOutline(
  vs: readonly Vertex[],
  corners: readonly number[],
  r: number,
): FilletOutcome {
  if (!Number.isFinite(r) || r < EPS) return { ok: false, error: 'length' };
  const n = vs.length;
  const set = new Set(corners);
  if (set.size === 0) return { ok: false, error: 'corner' };
  for (const i of set) {
    if (!Number.isInteger(i) || i < 0 || i >= n) return { ok: false, error: 'index' };
    if (!isSharpLineCorner(vs, i)) return { ok: false, error: 'corner' };
  }
  const len = (i: number) => {
    const a = at(vs, i);
    const b = at(vs, i + 1);
    return Math.hypot(b.x - a.x, b.y - a.y);
  };
  /** Room for a tangent point on segment i next to the corner at its start / end. */
  const room = (seg: number) => (set.has(seg) && set.has((seg + 1) % n) ? len(seg) / 2 : len(seg));
  const radii = new Map<number, number>();
  const cuts = new Map<number, number>();
  let clamped = false;
  for (const i of set) {
    const half = Math.abs(cornerTurn(vs, i)) / 2;
    const want = r * Math.tan(half);
    const fit = Math.min(want, room((i - 1 + n) % n), room(i));
    if (fit < want - EPS) clamped = true;
    cuts.set(i, fit);
    radii.set(i, tidy(fit / Math.tan(half)));
  }
  const out: Vertex[] = [];
  for (let i = 0; i < n; i++) {
    const v = at(vs, i);
    const d = cuts.get(i);
    if (d === undefined) {
      out.push({ ...v });
      continue;
    }
    const prev = at(vs, i - 1);
    const next = at(vs, i + 1);
    const uin = unit(prev, v);
    const uout = unit(v, next);
    const turn = cornerTurn(vs, i);
    out.push({ x: tidy(v.x - uin.x * d), y: tidy(v.y - uin.y * d), bulge: sweepToBulge(turn) });
    out.push({ x: tidy(v.x + uout.x * d), y: tidy(v.y + uout.y * d), bulge: v.bulge });
  }
  const vertices = dropZeroSegments(out);
  const error = checkOutline(vertices);
  if (error) return { ok: false, error };
  return { ok: true, vertices, radii: corners.map((i) => radii.get(i) ?? 0), clamped };
}

/** Drops every vertex whose outgoing segment has no length (a tangent point on a corner). */
function dropZeroSegments(vs: readonly Vertex[]): Vertex[] {
  const out = vs.filter((v, i) => {
    const w = vs[(i + 1) % vs.length] as Vertex;
    return Math.hypot(w.x - v.x, w.y - v.y) >= EPS;
  });
  return out.length >= 2 ? out : vs.map((v) => ({ ...v }));
}

/** A spot where the tool cannot reach (spec §4.4 "iç köşe"). */
export interface TightCorner {
  /** Sharp concave corner at vertex `index`, or a concave arc on segment `index`. */
  kind: 'corner' | 'arc';
  index: number;
  /** Radius there (0 for a sharp corner), mm. */
  radius: number;
  /** A sharp corner between two straight segments: "otomatik düzelt" can fillet it. */
  fixable: boolean;
}

/**
 * Concave corners of an outer outline (CCW) that are tighter than the tool radius: sharp concave
 * corners and concave arcs (bulge < 0) with a radius below `toolRadius`. Convex corners may stay
 * sharp. A corner already opened by a dogbone / T-bone (an overcut arc of tool radius) counts as
 * reachable.
 */
export function tightCorners(vs: readonly Vertex[], toolRadius: number): TightCorner[] {
  if (!(toolRadius > EPS) || vs.length < 3) return [];
  const out: TightCorner[] = [];
  vs.forEach((v, i) => {
    if (cornerTurn(vs, i) < -MIN_TURN) {
      out.push({ kind: 'corner', index: i, radius: 0, fixable: isSharpLineCorner(vs, i) });
    }
    const arc = arcOf(v, at(vs, i + 1), v.bulge);
    if (arc && v.bulge < 0 && arc.radius < toolRadius - EPS) {
      out.push({ kind: 'arc', index: i, radius: tidy(arc.radius), fixable: false });
    }
  });
  return out;
}

/**
 * Inner-corner auto-fix (spec §4.4 "otomatik düzelt"): every fixable sharp concave corner is
 * filleted with the tool radius. Undefined when there is nothing to fix.
 */
export function fixTightCorners(
  vs: readonly Vertex[],
  toolRadius: number,
): FilletOutcome | undefined {
  const fix = tightCorners(vs, toolRadius)
    .filter((c) => c.kind === 'corner' && c.fixable)
    .map((c) => c.index);
  if (fix.length === 0) return undefined;
  return filletOutline(vs, fix, toolRadius);
}

/** Overcut style (spec §4.4): along the corner bisector, or along one of its two edges. */
export type DogboneStyle = 'dogbone' | 'tbone-prev' | 'tbone-next';

export type DogboneOutcome =
  { ok: true; vertices: Vertex[] } | { ok: false; error: OutlineEditError | 'corner' };

/**
 * Opens a sharp concave corner (vertex `index`, two straight segments) with an overcut circle of
 * the tool radius `r` (spec §4.4 "Dogbone / T-bone"), so a tool of radius r reaches the corner
 * point and a mating part seats fully.
 * - `dogbone`: the circle's centre lies on the corner bisector, r away from the corner, inside the
 *   cut-away region; the outline follows its arc through the corner point.
 * - `tbone-prev` / `tbone-next`: the centre lies on the incoming / outgoing edge, r away from the
 *   corner; the overcut runs along that edge.
 */
export function dogboneOutline(
  vs: readonly Vertex[],
  index: number,
  r: number,
  style: DogboneStyle,
): DogboneOutcome {
  const n = vs.length;
  if (!Number.isInteger(index) || index < 0 || index >= n) return { ok: false, error: 'index' };
  if (!Number.isFinite(r) || r < EPS) return { ok: false, error: 'length' };
  if (!isSharpLineCorner(vs, index) || cornerTurn(vs, index) > -MIN_TURN) {
    return { ok: false, error: 'corner' };
  }
  const prev = at(vs, index - 1);
  const v = at(vs, index);
  const next = at(vs, index + 1);
  const uin = unit(prev, v);
  const uout = unit(v, next);
  const lenIn = Math.hypot(v.x - prev.x, v.y - prev.y);
  const lenOut = Math.hypot(next.x - v.x, next.y - v.y);
  const p = (o: Point, u: Point, t: number) => ({ x: tidy(o.x + u.x * t), y: tidy(o.y + u.y * t) });
  let replace: Vertex[];
  if (style === 'dogbone') {
    // Bisector of the cut-away wedge (between −uin and uout); the circle passes through v.
    const b = unit({ x: 0, y: 0 }, { x: uout.x - uin.x, y: uout.y - uin.y });
    const t = -2 * r * (uin.x * b.x + uin.y * b.y);
    const s = 2 * r * (uout.x * b.x + uout.y * b.y);
    if (t > lenIn - EPS || s > lenOut - EPS) return { ok: false, error: 'length' };
    const p1 = p(v, uin, -t);
    const p2 = p(v, uout, s);
    replace = [
      { ...p1, bulge: bulgeThrough(p1, v, p2) },
      { ...p2, bulge: v.bulge },
    ];
  } else if (style === 'tbone-prev') {
    // Centre on the incoming edge; the overcut is a half circle into the material beside it.
    if (2 * r > lenIn - EPS) return { ok: false, error: 'length' };
    const c = p(v, uin, -r);
    const left = { x: -uin.y, y: uin.x };
    const p1 = p(v, uin, -2 * r);
    replace = [
      { ...p1, bulge: bulgeThrough(p1, p(c, left, r), v) },
      { x: v.x, y: v.y, bulge: v.bulge },
    ];
  } else {
    if (2 * r > lenOut - EPS) return { ok: false, error: 'length' };
    const c = p(v, uout, r);
    const left = { x: -uout.y, y: uout.x };
    const p2 = p(v, uout, 2 * r);
    replace = [
      { x: v.x, y: v.y, bulge: bulgeThrough(v, p(c, left, r), p2) },
      { ...p2, bulge: v.bulge },
    ];
  }
  const vertices = [
    ...vs.slice(0, index).map((x) => ({ ...x })),
    ...replace,
    ...vs.slice(index + 1).map((x) => ({ ...x })),
  ];
  const error = checkOutline(vertices);
  return error ? { ok: false, error } : { ok: true, vertices };
}
