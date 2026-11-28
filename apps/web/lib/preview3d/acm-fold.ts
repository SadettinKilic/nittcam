/**
 * T391 (D-131, analysis `docs/metal/metal-analizi.md` §4.6): the fold preview ("Katla") of an ACM
 * part on the montaj tezgâhı. Every straight V-groove (MB5, `vGrooveLines`) is a hinge: the part
 * outline is split along the groove centre lines into a base and flanges, each flange turns about
 * its bend centre toward the grooved face, flanges on flanges follow their parent. The folded
 * pieces are checked against each other (overlap = red, corner gap shown, no corner relief).
 *
 * Bend model (one per groove, documented in the analysis): remaining skin `s`, V-bit tip flat `b`,
 * included angle `α`, designed fold angle `θ`:
 *   neutral radius  r_n = max(s / 2, b / θ)      (the flat groove bottom becomes the bend arc)
 *   inner radius    r_i = r_n − s / 2           (groove side of the skin)
 *   outer radius    r_o = r_n + s / 2           (the décor face)
 *   bend allowance  BA  = θ · r_n               (neutral arc length)
 * The V walls meet at θ = α; a larger fold crushes them (`overFold`).
 *
 * Display only: never changes the project, nesting, toolpath or NC. Pure.
 */
import {
  contour,
  innerOperation,
  normalize,
  vGrooveLines,
  type ContourOperation,
  type Part,
  type VGrooveTraits,
  type Vertex,
} from '@nittcam/core';
import { flatten } from './outlines';
import { localOutline, partMesh, ringArea, type MeshData } from './part-mesh';
import {
  add,
  cross,
  dot,
  qAxisAngle,
  qMul,
  qRotate,
  scale,
  sub,
  IDENTITY,
  type Quat,
  type V3,
} from './assembly-math';

/** The V-bit and stock facts a fold needs. */
export interface FoldTool {
  /** V-bit included angle, degrees (90° when the machine has no V-bit). */
  angleDeg: number;
  /** V-bit flat tip diameter, mm. */
  tipDiameter: number;
  traits: VGrooveTraits | null;
  /** The face the grooves open on (part frame: `back` = z = 0, `front` = z = T). */
  face: 'front' | 'back';
}

export interface Bend {
  /** Neutral fibre radius, mm. */
  rNeutral: number;
  rInner: number;
  rOuter: number;
  /** Bend allowance (neutral arc length) at the designed angle, mm. */
  allowance: number;
  /** The designed angle folds past the V angle (the groove walls are crushed). */
  overFold: boolean;
}

const RAD = Math.PI / 180;
const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/** The bend of one groove (see the module comment). */
export function bendOf(
  remaining: number,
  tool: Pick<FoldTool, 'angleDeg' | 'tipDiameter'>,
  foldDeg: number,
): Bend {
  const s = Math.max(0, remaining);
  const theta = Math.max(0, foldDeg) * RAD;
  const rNeutral = Math.max(s / 2, theta > 1e-9 ? Math.max(0, tool.tipDiameter) / theta : 0);
  return {
    rNeutral: r4(rNeutral),
    rInner: r4(rNeutral - s / 2),
    rOuter: r4(rNeutral + s / 2),
    allowance: r4(theta * rNeutral),
    overFold: foldDeg > tool.angleDeg + 0.5,
  };
}

/**
 * Outer flange length after a 90° fold (from the outside of the base to the flange edge, mm), for
 * a flat flange `flat` mm from the groove centre to the edge: `flat + r_o − BA / 2`. The flat
 * length for a wanted outer length is the inverse.
 */
export function outerFlange90(flat: number, bend: Bend): number {
  return r4(flat + bend.rOuter - bend.allowance / 2);
}
export function flatFlange90(outer: number, bend: Bend): number {
  return r4(outer - bend.rOuter + bend.allowance / 2);
}

type P = { x: number; y: number };

export interface Hinge {
  /** `line-3` / stable per part: the open line index of the groove. */
  key: string;
  a: P;
  b: P;
  /** Unit normal into the flange (away from the base). */
  n: P;
  /** Parent hinge index (−1 = the flange hangs on the base). */
  parent: number;
  remaining: number;
}

export interface FoldPiece {
  /** −1 = the base, else the hinge index the piece turns about. */
  hinge: number;
  /** Outline (flat x, y pairs, CCW). */
  ring: number[];
}

export interface FoldPlan {
  hinges: Hinge[];
  pieces: FoldPiece[];
  /** Grooves that cannot fold here: closed or curved ones. */
  skipped: number;
}

const STRAIGHT_MM = 0.05;

function straight(vs: readonly Vertex[]): [P, P] | null {
  const first = vs[0];
  const last = vs[vs.length - 1];
  if (!first || !last || vs.length < 2) return null;
  if (vs.slice(0, -1).some((v) => Math.abs(v.bulge) > 1e-9)) return null;
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const l = Math.hypot(dx, dy);
  if (l < 1) return null;
  for (const v of vs) {
    if (Math.abs((v.x - first.x) * dy - (v.y - first.y) * dx) / l > STRAIGHT_MM) return null;
  }
  return [
    { x: first.x, y: first.y },
    { x: last.x, y: last.y },
  ];
}

/** Signed distance of `p` from the line a→b, positive on the side of `n`. */
function side(h: Pick<Hinge, 'a' | 'n'>, p: P): number {
  return (p.x - h.a.x) * h.n.x + (p.y - h.a.y) * h.n.y;
}

/** Sutherland–Hodgman: the ring clipped to `side(h, p) · keep ≥ 0`. */
export function clipRing(
  ring: readonly number[],
  h: Pick<Hinge, 'a' | 'n'>,
  keep: 1 | -1,
): number[] {
  const out: number[] = [];
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const p = { x: ring[2 * i] ?? 0, y: ring[2 * i + 1] ?? 0 };
    const j = (i + 1) % n;
    const q = { x: ring[2 * j] ?? 0, y: ring[2 * j + 1] ?? 0 };
    const dp = side(h, p) * keep;
    const dq = side(h, q) * keep;
    if (dp >= 0) out.push(p.x, p.y);
    if (dp >= 0 !== dq >= 0 && Math.abs(dp - dq) > 1e-12) {
      const t = dp / (dp - dq);
      out.push(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t);
    }
  }
  // Drop repeated points.
  const clean: number[] = [];
  for (let i = 0; i < out.length; i += 2) {
    const x = out[i] ?? 0;
    const y = out[i + 1] ?? 0;
    const px = clean[clean.length - 2];
    const py = clean[clean.length - 1];
    if (px !== undefined && py !== undefined && Math.hypot(x - px, y - py) < 1e-6) continue;
    clean.push(x, y);
  }
  return simplify(clean);
}

/**
 * Drops repeated and collinear points, also the zero-width spikes the clip leaves along the clip
 * line where the outline touches it (they would widen the piece's hull).
 */
function simplify(ring: number[]): number[] {
  const pts: P[] = [];
  for (let i = 0; i + 1 < ring.length; i += 2) pts.push({ x: ring[i] ?? 0, y: ring[i + 1] ?? 0 });
  let changed = true;
  while (changed && pts.length >= 3) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length >= 3; i++) {
      const a = pts[(i + pts.length - 1) % pts.length] as P;
      const p = pts[i] as P;
      const b = pts[(i + 1) % pts.length] as P;
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      const c = (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x);
      if (Math.hypot(p.x - a.x, p.y - a.y) < 1e-6 || Math.abs(c) <= 1e-6 * Math.max(l, 1)) {
        pts.splice(i, 1);
        changed = true;
        i--;
      }
    }
  }
  return pts.length >= 3 ? pts.flatMap((p) => [p.x, p.y]) : [];
}

function centroid(ring: readonly number[]): P {
  let a = 0;
  let cx = 0;
  let cy = 0;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const x0 = ring[2 * i] ?? 0;
    const y0 = ring[2 * i + 1] ?? 0;
    const x1 = ring[2 * ((i + 1) % n)] ?? 0;
    const y1 = ring[2 * ((i + 1) % n) + 1] ?? 0;
    const c = x0 * y1 - x1 * y0;
    a += c;
    cx += (x0 + x1) * c;
    cy += (y0 + y1) * c;
  }
  if (Math.abs(a) < 1e-9) return { x: ring[0] ?? 0, y: ring[1] ?? 0 };
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

const MIN_PIECE_MM2 = 1;

/**
 * The hinges and pieces of a part. The base is the piece holding the outline's centroid; a groove
 * whose midpoint lies in another groove's flange is a flange on that flange.
 */
export function foldPlan(part: Part, traits: VGrooveTraits | null): FoldPlan {
  const outline = localOutline(part);
  const ref = centroid(outline);
  const lines: { key: string; a: P; b: P; remaining: number }[] = [];
  let skipped = 0;
  for (const g of vGrooveLines(part, traits)) {
    const ab = g.closed ? null : straight(g.vertices);
    if (!ab) {
      skipped++;
      continue;
    }
    lines.push({ key: `${g.type}-${g.index}`, a: ab[0], b: ab[1], remaining: g.remaining });
  }
  const normalTo = (l: { a: P; b: P }, from: P): P => {
    const dx = l.b.x - l.a.x;
    const dy = l.b.y - l.a.y;
    const len = Math.hypot(dx, dy);
    let n = { x: -dy / len, y: dx / len };
    if (side({ a: l.a, n }, from) > 0) n = { x: -n.x, y: -n.y };
    return n;
  };
  const mid = (l: { a: P; b: P }): P => ({ x: (l.a.x + l.b.x) / 2, y: (l.a.y + l.b.y) / 2 });
  // Normals away from the centroid; parent = the nearest groove whose flange holds the midpoint.
  const base = lines.map((l) => ({ ...l, n: normalTo(l, ref) }));
  const parents = base.map((l, i) => {
    const m = mid(l);
    let best = -1;
    let bestD = Infinity;
    base.forEach((o, j) => {
      if (j === i) return;
      const d = side(o, m);
      if (d > 1e-6 && d < bestD) {
        bestD = d;
        best = j;
      }
    });
    return best;
  });
  // Break cycles (crossing grooves): a groove that reaches itself hangs on the base.
  parents.forEach((_, i) => {
    const seen = new Set<number>([i]);
    let p = parents[i] ?? -1;
    while (p >= 0) {
      if (seen.has(p)) {
        parents[i] = -1;
        break;
      }
      seen.add(p);
      p = parents[p] ?? -1;
    }
  });
  const hinges: Hinge[] = base.map((l, i) => {
    const parent = parents[i] ?? -1;
    const from = parent >= 0 ? mid(base[parent] as (typeof base)[number]) : ref;
    return { key: l.key, a: l.a, b: l.b, n: normalTo(l, from), parent, remaining: l.remaining };
  });
  const children = (i: number) => hinges.flatMap((h, j) => (h.parent === i ? [j] : []));
  const ancestors = (i: number): number[] => {
    const out: number[] = [];
    for (let p = hinges[i]?.parent ?? -1; p >= 0; p = hinges[p]?.parent ?? -1) out.push(p);
    return out;
  };
  const pieces: FoldPiece[] = [];
  const push = (hinge: number, ring: number[]) => {
    if (ring.length >= 6 && Math.abs(ringArea(ring)) >= MIN_PIECE_MM2) pieces.push({ hinge, ring });
  };
  let baseRing = outline;
  for (const j of children(-1)) baseRing = clipRing(baseRing, hinges[j] as Hinge, -1);
  push(-1, baseRing);
  hinges.forEach((h, i) => {
    let ring = clipRing(outline, h, 1);
    for (const p of ancestors(i)) ring = clipRing(ring, hinges[p] as Hinge, 1);
    for (const c of children(i)) ring = clipRing(ring, hinges[c] as Hinge, -1);
    push(i, ring);
  });
  return { hinges, pieces, skipped };
}

/** A rigid transform p → q·p + t (part frame, mm). */
export interface Rigid {
  q: Quat;
  t: V3;
}
export const RIGID_ID: Rigid = { q: IDENTITY, t: [0, 0, 0] };

export function applyRigid(r: Rigid, p: V3): V3 {
  return add(qRotate(r.q, p), r.t);
}
function compose(outer: Rigid, inner: Rigid): Rigid {
  return { q: qMul(outer.q, inner.q), t: add(qRotate(outer.q, inner.t), outer.t) };
}

/**
 * The transform of every hinge's flange at the fold angles `deg` (per hinge) with the bend radii
 * of the designed angles `designed`: the flange shifts back by the allowance it bends into, then
 * turns about the bend centre (r_n from the neutral fibre, on the grooved side).
 */
export function foldTransforms(
  plan: FoldPlan,
  thickness: number,
  tool: FoldTool,
  deg: readonly number[],
  designed: readonly number[],
): Rigid[] {
  const T = thickness;
  const g = tool.face === 'back' ? -1 : 1;
  const out: (Rigid | undefined)[] = [];
  const of = (i: number): Rigid => {
    const hit = out[i];
    if (hit) return hit;
    const h = plan.hinges[i] as Hinge;
    const s = Math.min(h.remaining, T);
    const bend = bendOf(s, tool, designed[i] ?? 90);
    const theta = (deg[i] ?? 0) * RAD;
    const half = (theta * bend.rNeutral) / 2;
    const zN = g < 0 ? T - s / 2 : s / 2;
    const n: V3 = [h.n.x, h.n.y, 0];
    const centre: V3 = [h.a.x - half * h.n.x, h.a.y - half * h.n.y, zN + g * bend.rNeutral];
    const axis = cross(n, [0, 0, g]);
    const q = qAxisAngle(axis, theta);
    const own: Rigid = { q, t: sub(centre, qRotate(q, add(centre, scale(n, 2 * half)))) };
    const r = h.parent >= 0 ? compose(of(h.parent), own) : own;
    out[i] = r;
    return r;
  };
  return plan.hinges.map((_, i) => of(i));
}

function inside(ring: readonly number[], x: number, y: number): boolean {
  let hit = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[2 * i] ?? 0;
    const yi = ring[2 * i + 1] ?? 0;
    const xj = ring[2 * j] ?? 0;
    const yj = ring[2 * j + 1] ?? 0;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

const vertices = (ring: readonly number[]): Vertex[] => {
  const out: Vertex[] = [];
  for (let i = 0; i + 1 < ring.length; i += 2)
    out.push({ x: ring[i] ?? 0, y: ring[i + 1] ?? 0, bulge: 0 });
  return out;
};

/** The piece as a flat part: its outline, the holes and cut inner contours lying on it. */
export function pieceAsPart(part: Part, ring: readonly number[]): Part {
  const holes = part.holes.filter((h) => inside(ring, h.cx, h.cy));
  const inners: Vertex[][] = [];
  const ops: ContourOperation[] = [];
  part.inners.forEach((c, k) => {
    const op = innerOperation(part, k);
    if (op.kind === 'vgroove' || op.kind === 'none') return;
    const flat = flatten(normalize(contour(c), 'inner'));
    for (let i = 0; i + 1 < flat.length; i += 2)
      if (!inside(ring, flat[i] ?? 0, flat[i + 1] ?? 0)) return;
    inners.push(c.map((v) => ({ ...v })));
    ops.push(op);
  });
  return {
    id: part.id,
    name: part.name,
    qty: 1,
    grain: part.grain,
    kind: 'freeform',
    outline: vertices(ring),
    inners,
    holes,
    ops: { inners: ops },
    edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
    templates: [],
  } as unknown as Part;
}

function transformed(src: Float32Array, r: Rigid, rotateOnly: boolean): Float32Array {
  const out = new Float32Array(src.length);
  for (let i = 0; i + 2 < src.length; i += 3) {
    const v: V3 = [src[i] ?? 0, src[i + 1] ?? 0, src[i + 2] ?? 0];
    const w = rotateOnly ? qRotate(r.q, v) : applyRigid(r, v);
    out[i] = w[0];
    out[i + 1] = w[1];
    out[i + 2] = w[2];
  }
  return out;
}

/** The folded part as one mesh in the part frame (the base stays where it lies flat). */
export function foldedMesh(
  part: Part,
  plan: FoldPlan,
  thickness: number,
  rigid: readonly Rigid[],
): MeshData {
  const meshes = plan.pieces.map((p) => {
    const m = partMesh(pieceAsPart(part, p.ring), thickness);
    const r = p.hinge >= 0 ? (rigid[p.hinge] ?? RIGID_ID) : RIGID_ID;
    return {
      ...m,
      positions: transformed(m.positions, r, false),
      normals: transformed(m.normals, r, true),
      edges: transformed(m.edges, r, false),
    };
  });
  const size = (k: 'positions' | 'bands' | 'indices' | 'edges') =>
    meshes.reduce((a, m) => a + m[k].length, 0);
  const positions = new Float32Array(size('positions'));
  const normals = new Float32Array(size('positions'));
  const bands = new Float32Array(size('bands'));
  const indices = new Uint32Array(size('indices'));
  const edges = new Float32Array(size('edges'));
  let pv = 0;
  let pb = 0;
  let pi = 0;
  let pe = 0;
  for (const m of meshes) {
    const base = pv / 3;
    positions.set(m.positions, pv);
    normals.set(m.normals, pv);
    bands.set(m.bands, pb);
    for (let i = 0; i < m.indices.length; i++) indices[pi + i] = (m.indices[i] ?? 0) + base;
    edges.set(m.edges, pe);
    pv += m.positions.length;
    pb += m.bands.length;
    pi += m.indices.length;
    pe += m.edges.length;
  }
  return {
    positions,
    normals,
    bands,
    indices,
    edges,
    openings: meshes.reduce((a, m) => a + m.openings, 0),
    throughOpenings: meshes.reduce((a, m) => a + m.throughOpenings, 0),
  };
}

// ---- fold check: convex prisms, separating axes ----------------------------------------------

/** Convex hull of a ring (CCW, monotone chain). */
export function hull(ring: readonly number[]): P[] {
  const pts: P[] = [];
  for (let i = 0; i + 1 < ring.length; i += 2) pts.push({ x: ring[i] ?? 0, y: ring[i + 1] ?? 0 });
  pts.sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const turn = (o: P, a: P, b: P) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: P[] = [];
  for (const p of pts) {
    while (
      lower.length >= 2 &&
      turn(lower[lower.length - 2] as P, lower[lower.length - 1] as P, p) <= 1e-9
    )
      lower.pop();
    lower.push(p);
  }
  const upper: P[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i] as P;
    while (
      upper.length >= 2 &&
      turn(upper[upper.length - 2] as P, upper[upper.length - 1] as P, p) <= 1e-9
    )
      upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

interface Prism {
  pts: V3[];
  /** Face normals and edge directions (world). */
  normals: V3[];
  dirs: V3[];
}

function prism(h: readonly P[], z0: number, z1: number, r: Rigid): Prism {
  const pts: V3[] = [];
  for (const p of h) pts.push(applyRigid(r, [p.x, p.y, z0]), applyRigid(r, [p.x, p.y, z1]));
  const up = qRotate(r.q, [0, 0, 1]);
  const normals: V3[] = [up];
  const dirs: V3[] = [up];
  h.forEach((p, i) => {
    const q = h[(i + 1) % h.length] as P;
    const d: V3 = [q.x - p.x, q.y - p.y, 0];
    dirs.push(qRotate(r.q, d));
    normals.push(qRotate(r.q, [d[1], -d[0], 0]));
  });
  return { pts, normals, dirs };
}

/**
 * Separating-axis test of two convex prisms: `> 0` = the gap along the best separating axis
 * (a lower bound of the distance, exact for face-to-face gaps), `≤ 0` = minus the penetration.
 */
export function prismGap(a: Prism, b: Prism): number {
  const axes: V3[] = [...a.normals, ...b.normals];
  for (const da of a.dirs) for (const db of b.dirs) axes.push(cross(da, db));
  let gap = -Infinity;
  let pen = Infinity;
  for (const ax of axes) {
    const l = Math.hypot(ax[0], ax[1], ax[2]);
    if (l < 1e-9) continue;
    const u = scale(ax, 1 / l);
    let a0 = Infinity;
    let a1 = -Infinity;
    let b0 = Infinity;
    let b1 = -Infinity;
    for (const p of a.pts) {
      const d = dot(p, u);
      a0 = Math.min(a0, d);
      a1 = Math.max(a1, d);
    }
    for (const p of b.pts) {
      const d = dot(p, u);
      b0 = Math.min(b0, d);
      b1 = Math.max(b1, d);
    }
    const overlap = Math.min(a1, b1) - Math.max(a0, b0);
    if (overlap < 0) gap = Math.max(gap, -overlap);
    else pen = Math.min(pen, overlap);
  }
  return gap > -Infinity ? gap : -pen;
}

/** Overlap below this is a touch, not a clash (mm, as the fit check). */
export const FOLD_TOUCH_MM = 0.05;
/** A corner gap up to this closes (mm). */
export const FOLD_CLOSED_MM = 1;

export type FoldIssue =
  /** Two flanges share material in the flat part: no corner relief between them. */
  | { kind: 'relief'; a: number; b: number }
  /** Two folded pieces overlap by `depth` mm. */
  | { kind: 'overlap'; a: number; b: number; depth: number }
  /** Two neighbouring flanges (non-parallel hinges, same parent) leave `gap` mm at the corner. */
  | { kind: 'corner'; a: number; b: number; gap: number };

export interface FoldCheck {
  issues: FoldIssue[];
  /** `clash` = overlap or missing relief; `gap` = a corner gap above FOLD_CLOSED_MM; else `closed`. */
  state: 'closed' | 'gap' | 'clash';
}

/**
 * Checks the folded pieces (piece indices of `plan.pieces` in the issues). A piece and the piece it
 * hangs on are not compared (they meet in the bend).
 */
export function foldCheck(plan: FoldPlan, thickness: number, rigid: readonly Rigid[]): FoldCheck {
  const hulls = plan.pieces.map((p) => hull(p.ring));
  const flat = hulls.map((h) => prism(h, 0, thickness, RIGID_ID));
  const folded = plan.pieces.map((p, i) =>
    prism(hulls[i] as P[], 0, thickness, p.hinge >= 0 ? (rigid[p.hinge] ?? RIGID_ID) : RIGID_ID),
  );
  const parentPiece = (k: number): number => {
    const h = plan.pieces[k]?.hinge ?? -1;
    if (h < 0) return -2;
    const ph = plan.hinges[h]?.parent ?? -1;
    return plan.pieces.findIndex((p) => p.hinge === ph);
  };
  const issues: FoldIssue[] = [];
  for (let i = 0; i < plan.pieces.length; i++) {
    for (let j = i + 1; j < plan.pieces.length; j++) {
      if (parentPiece(i) === j || parentPiece(j) === i) continue;
      if (prismGap(flat[i] as Prism, flat[j] as Prism) < -FOLD_TOUCH_MM) {
        issues.push({ kind: 'relief', a: i, b: j });
        continue;
      }
      const g = prismGap(folded[i] as Prism, folded[j] as Prism);
      if (g < -FOLD_TOUCH_MM) {
        issues.push({ kind: 'overlap', a: i, b: j, depth: r4(-g) });
        continue;
      }
      const hi = plan.hinges[plan.pieces[i]?.hinge ?? -1];
      const hj = plan.hinges[plan.pieces[j]?.hinge ?? -1];
      if (hi && hj && hi.parent === hj.parent && Math.abs(hi.n.x * hj.n.y - hi.n.y * hj.n.x) > 0.1)
        issues.push({ kind: 'corner', a: i, b: j, gap: r4(Math.max(0, g)) });
    }
  }
  const state = issues.some((x) => x.kind !== 'corner')
    ? 'clash'
    : issues.some((x) => x.kind === 'corner' && x.gap > FOLD_CLOSED_MM)
      ? 'gap'
      : 'closed';
  return { issues, state };
}
