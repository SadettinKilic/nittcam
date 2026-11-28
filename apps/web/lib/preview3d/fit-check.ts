/**
 * "Oturuyor mu?" fit check (T388, D-131): overlaps, small gaps and hole alignment between the
 * visible part copies on the montaj tezgâhı. Pure math on oriented boxes (separating axis test);
 * the worker (`fit-check.worker.ts`) adds an exact mesh test (three-mesh-bvh) for parts whose
 * outline is not a rectangle. Display only: never blocks export, never changes nesting or NC.
 */
import {
  add,
  axesOf,
  boxCentre,
  boxSize,
  cross,
  dot,
  len,
  qRotate,
  scale,
  sub,
  worldBounds,
  type LocalBox,
  type Pose,
  type Quat,
  type V3,
} from './assembly-math';

/** Array element that must exist (indices come from the same array). */
export function at<T>(list: readonly T[], i: number): T {
  const v = list[i];
  if (v === undefined) throw new Error(`index ${i} out of range`);
  return v;
}

/** Touching within this (gap or overlap), mm, counts as a fit. */
export const TOUCH_MM = 0.05;
/** Gaps up to this, mm, are listed ("boşluk 0,6 mm"). */
export const GAP_LIST_MM = 1;
/** Hole centres this close on mating faces, mm, are aligned (green); farther = orange. */
export const HOLE_OK_MM = 0.2;
/** A hole looks for its partner on the other face within this radius, mm. */
export const HOLE_SEARCH_MM = 10;
/** Two faces this close (and facing each other), mm, are mating faces for the hole check. */
export const MATE_FACE_MM = GAP_LIST_MM;

/** A face hole in the part's local mesh frame (top face = box.max z; through = on both faces). */
export interface FitHole {
  cx: number;
  cy: number;
  d: number;
  through: boolean;
}

export interface FitPart {
  id: string;
  box: LocalBox;
  pose: Pose;
  holes: readonly FitHole[];
  /** Outline is (nearly) its bounding rectangle: the box test is exact. */
  boxy: boolean;
}

export type FitIssue =
  | { kind: 'overlap'; a: string; b: string; depth: number }
  | { kind: 'gap'; a: string; b: string; gap: number }
  | {
      kind: 'hole';
      a: string;
      b: string;
      /** In-plane offset between the two hole centres, mm. */
      offset: number;
      ok: boolean;
      /** World centre of A's hole. */
      at: V3;
    };

export interface FitResult {
  issues: FitIssue[];
  /** Pairs that touch within ±TOUCH_MM (a fit). */
  touching: number;
  parts: number;
  /**
   * T397 (CTO #14 P5): ids of parts that touch (or overlap) no other part. Empty with fewer than
   * two parts: a lone part has nothing to fit against.
   */
  loose: string[];
}

/**
 * Exact answer for a pair whose boxes are within GAP_LIST_MM (worker: mesh BVH). `overlap` = the
 * meshes intersect; `distance` = closest distance when they do not (Infinity = farther than the
 * gap limit). Null = no mesh test available, keep the box answer.
 */
export type NarrowTest = (
  a: number,
  b: number,
  /** The box test's overlap depth (an upper bound for the mesh push-out). */
  boxDepth: number,
) => { overlap: boolean; distance: number; depth?: number } | null;

interface Obb {
  c: V3;
  axes: [V3, V3, V3];
  half: V3;
}

export function obbOf(pose: Pose, box: LocalBox): Obb {
  return { c: pose.position, axes: axesOf(pose.rotation), half: scale(boxSize(box), 0.5) };
}

function radius(o: Obb, l: V3): number {
  return (
    Math.abs(dot(o.axes[0], l)) * o.half[0] +
    Math.abs(dot(o.axes[1], l)) * o.half[1] +
    Math.abs(dot(o.axes[2], l)) * o.half[2]
  );
}

/**
 * Separating axis test of two oriented boxes. Positive = overlap depth (smallest push-out along
 * the 15 axes); negative = −gap (largest separation found; exact for faces that face each other).
 */
export function obbSeparation(a: Obb, b: Obb): number {
  const d = sub(b.c, a.c);
  let minOverlap = Infinity;
  let maxGap = -Infinity;
  const test = (l: V3) => {
    const n = len(l);
    if (n < 1e-6) return;
    const u = scale(l, 1 / n);
    const s = radius(a, u) + radius(b, u) - Math.abs(dot(d, u));
    if (s < 0) maxGap = Math.max(maxGap, -s);
    else minOverlap = Math.min(minOverlap, s);
  };
  for (const ax of a.axes) test(ax);
  for (const bx of b.axes) test(bx);
  for (const ax of a.axes) for (const bx of b.axes) test(cross(ax, bx));
  return maxGap > -Infinity ? -maxGap : minOverlap;
}

/** World point of a local mesh point of a placed part (world = position + R · (local − centre)). */
export function toWorld(pose: Pose, box: LocalBox, local: V3): V3 {
  return add(pose.position, qRotate(pose.rotation, sub(local, boxCentre(box))));
}

function conj(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

/** Local mesh point of a world point (inverse of `toWorld`). */
export function toLocal(pose: Pose, box: LocalBox, world: V3): V3 {
  return add(qRotate(conj(pose.rotation), sub(world, pose.position)), boxCentre(box));
}

interface FaceHoles {
  normal: V3;
  /** Plane offset along the normal. */
  plane: number;
  side: 1 | -1;
  holes: { w: V3; h: FitHole }[];
}

/** The two large (local z) faces of a part with the holes that open on each. */
function zFaces(p: FitPart): FaceHoles[] {
  const zAxis = axesOf(p.pose.rotation)[2];
  return ([1, -1] as const).map((side) => {
    const z = side > 0 ? p.box.max[2] : p.box.min[2];
    const normal = scale(zAxis, side);
    const centre = toWorld(p.pose, p.box, [...boxCentre(p.box).slice(0, 2), z] as V3);
    const holes = p.holes
      .filter((h) => side > 0 || h.through)
      .map((h) => ({ w: toWorld(p.pose, p.box, [h.cx, h.cy, z]), h }));
    return { normal, plane: dot(centre, normal), side, holes };
  });
}

function insideFace(p: FitPart, world: V3): boolean {
  const l = toLocal(p.pose, p.box, world);
  const e = 1e-6;
  return (
    l[0] >= p.box.min[0] - e &&
    l[0] <= p.box.max[0] + e &&
    l[1] >= p.box.min[1] - e &&
    l[1] <= p.box.max[1] + e
  );
}

/** A hole of A on a face mating with B, and its nearest partner hole of B (T388, T390). */
export interface MatedHole {
  /** World centre of A's hole on A's face. */
  at: V3;
  /** A's face normal (out of A, into B). */
  normal: V3;
  a: FitHole;
  b: FitHole;
  /** In-plane offset between the two centres, mm (unrounded). */
  offset: number;
}

/**
 * Holes on mating faces of A and B (large faces facing each other within MATE_FACE_MM): every
 * hole of A that lands on B's face with its nearest hole of B within HOLE_SEARCH_MM.
 */
export function matedHoles(a: FitPart, b: FitPart): MatedHole[] {
  if (a.holes.length === 0 || b.holes.length === 0) return [];
  const out: MatedHole[] = [];
  for (const fa of zFaces(a)) {
    if (fa.holes.length === 0) continue;
    for (const fb of zFaces(b)) {
      if (fb.holes.length === 0 || dot(fa.normal, fb.normal) > -0.9999) continue;
      // B's face plane measured along A's normal (B's normal points the other way).
      if (Math.abs(fa.plane + fb.plane) > MATE_FACE_MM) continue;
      for (const ha of fa.holes) {
        if (!insideFace(b, ha.w)) continue;
        let best = Infinity;
        let partner: FitHole | null = null;
        for (const hb of fb.holes) {
          const d = sub(hb.w, ha.w);
          const inPlane = len(sub(d, scale(fa.normal, dot(d, fa.normal))));
          if (inPlane < best) {
            best = inPlane;
            partner = hb.h;
          }
        }
        if (best > HOLE_SEARCH_MM || !partner) continue;
        out.push({ at: ha.w, normal: fa.normal, a: ha.h, b: partner, offset: best });
      }
    }
  }
  return out;
}

/** Hole alignment issues of A and B: one per mated hole, green within HOLE_OK_MM. */
export function holeAlignment(a: FitPart, b: FitPart): FitIssue[] {
  return matedHoles(a, b).map((m) => ({
    kind: 'hole',
    a: a.id,
    b: b.id,
    offset: Math.round(m.offset * 100) / 100,
    ok: m.offset <= HOLE_OK_MM,
    at: m.at,
  }));
}

/** Candidate pairs whose world boxes come within `margin` (sweep along x). */
export function candidatePairs(parts: readonly FitPart[], margin: number): [number, number][] {
  const bounds = parts.map((p) => worldBounds(p.pose, p.box));
  const order = parts.map((_, i) => i).sort((i, j) => at(bounds, i).min[0] - at(bounds, j).min[0]);
  const out: [number, number][] = [];
  for (let k = 0; k < order.length; k++) {
    const i = at(order, k);
    const bi = at(bounds, i);
    for (let m = k + 1; m < order.length; m++) {
      const j = at(order, m);
      const bj = at(bounds, j);
      if (bj.min[0] > bi.max[0] + margin) break;
      if (
        bj.min[1] > bi.max[1] + margin ||
        bi.min[1] > bj.max[1] + margin ||
        bj.min[2] > bi.max[2] + margin ||
        bi.min[2] > bj.max[2] + margin
      )
        continue;
      out.push(i < j ? [i, j] : [j, i]);
    }
  }
  return out;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * The whole check: every pair of parts within GAP_LIST_MM. Overlap deeper than TOUCH_MM → red
 * (depth in mm); |separation| ≤ TOUCH_MM → touching (fit); gap ≤ GAP_LIST_MM → listed; then the
 * hole alignment of mating faces. Issues sorted: overlaps (deepest first), holes off, gaps,
 * aligned holes.
 */
export function checkFit(parts: readonly FitPart[], narrow?: NarrowTest): FitResult {
  const issues: FitIssue[] = [];
  let touching = 0;
  const contact = new Set<number>();
  const obbs = parts.map((p) => obbOf(p.pose, p.box));
  for (const [i, j] of candidatePairs(parts, GAP_LIST_MM)) {
    const a = at(parts, i);
    const b = at(parts, j);
    let s = obbSeparation(at(obbs, i), at(obbs, j));
    if (s < -GAP_LIST_MM) continue;
    if (!(a.boxy && b.boxy) && narrow) {
      const exact = narrow(i, j, s);
      // Meshes apart: their closest distance replaces the box gap (an L-shape's empty corner).
      // Meshes meeting: the mesh push-out depth replaces the box depth when known.
      if (exact && !exact.overlap) s = -exact.distance;
      else if (exact?.depth !== undefined) s = Math.max(exact.depth, TOUCH_MM * 1.01);
      if (s < -GAP_LIST_MM) continue;
    }
    if (s >= -TOUCH_MM) {
      contact.add(i);
      contact.add(j);
    }
    if (s > TOUCH_MM) issues.push({ kind: 'overlap', a: a.id, b: b.id, depth: round2(s) });
    else if (s >= -TOUCH_MM) touching++;
    else issues.push({ kind: 'gap', a: a.id, b: b.id, gap: round2(-s) });
    issues.push(...holeAlignment(a, b));
  }
  const rank = (x: FitIssue) => (x.kind === 'overlap' ? 0 : x.kind === 'hole' ? (x.ok ? 3 : 1) : 2);
  issues.sort((x, y) => {
    const r = rank(x) - rank(y);
    if (r !== 0) return r;
    if (x.kind === 'overlap' && y.kind === 'overlap') return y.depth - x.depth;
    if (x.kind === 'hole' && y.kind === 'hole') return y.offset - x.offset;
    if (x.kind === 'gap' && y.kind === 'gap') return x.gap - y.gap;
    return 0;
  });
  const loose = parts.length < 2 ? [] : parts.filter((_, i) => !contact.has(i)).map((p) => p.id);
  return { issues, touching, parts: parts.length, loose };
}
