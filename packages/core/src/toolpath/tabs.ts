/**
 * Tabs (holding bridges) and small-part auto tabs (spec §6.3, §2.4, §3.6; T015, D-022). Pure.
 *
 * Terms (all along the tool-centre loop of a pass, which starts at the start point P and runs in
 * the travel direction; positions are arc lengths from P):
 * - **width** w: the bridge width left in the material, measured along the contour.
 * - **raised span**: the part of the tool-centre path flown at the tab top. It is `w + D` long
 *   (D = tool diameter): a tool centre at the target depth cuts everything within the tool radius,
 *   so the narrowest part of the bridge (the kerf middle) is the raised span minus D = w.
 * - **tab top**: `target + height` (height measured up from the through-cut bottom).
 */
import { EPS } from '../geometry/constants';
import { bbox, signedArea } from '../geometry/polyline';
import type { Polyline } from '../geometry/types';
import { pathMoves, segLength, slicePath, type PathSeg } from './path';
import type { Move, Tab } from './types';

/** Built-in tab defaults, used when the material parameter set has none (D-022). */
export const TAB_DEFAULTS = {
  count: 4,
  /** Bridge width, mm. */
  width: 10,
  /** Material the built-in default leaves at most, mm (height = spoilboard + min(this, t / 2)). */
  materialLeft: 3,
  /** Small-part threshold: outline area below this gets auto tabs, mm² (0.05 m²). */
  smallPartArea: 50_000,
  /** Small-part threshold: smaller bounding-box side below this gets auto tabs, mm. */
  smallPartMinSide: 100,
  /** Fewest tabs on an auto-tabbed small part (one tab lets the part pivot). */
  smallPartMinCount: 2,
} as const;

/** Built-in default height: leaves min(3, t / 2) mm of material above the spoilboard allowance. */
export function defaultTabHeight(thickness: number, spoilboardAllowance: number): number {
  return spoilboardAllowance + Math.min(TAB_DEFAULTS.materialLeft, thickness / 2);
}

/**
 * Small part (§6.3 "Küçük parça güvenliği"): outline area below `areaLimit` mm² or the smaller
 * bounding-box side below `sideLimit` mm. Vacuum holds such parts poorly once they are cut free.
 */
export function isSmallPart(outline: Polyline, areaLimit: number, sideLimit: number): boolean {
  const box = bbox(outline);
  const side = Math.min(box.maxX - box.minX, box.maxY - box.minY);
  return Math.abs(signedArea(outline)) < areaLimit || side < sideLimit;
}

export interface Interval {
  lo: number;
  hi: number;
}

/**
 * Where a tab centre may go on a closed loop that starts at P (`segs`, in travel order):
 * - only on straight segments, at least `half` (= raised span / 2 = w/2 + tool radius) from both
 *   ends, so the raised span never touches a corner or an arc;
 * - the raised span stays out of `[0, keepFwd]` and `[total − keepBack, total]` (lead-in/out, the
 *   ramp and the plunge point around P).
 */
export function tabCentreIntervals(
  segs: readonly PathSeg[],
  half: number,
  keepFwd: number,
  keepBack: number,
): Interval[] {
  const total = segs.reduce((s, x) => s + segLength(x), 0);
  const out: Interval[] = [];
  let s0 = 0;
  for (const s of segs) {
    const l = segLength(s);
    if (s.bulge === 0) {
      const lo = Math.max(s0 + half, keepFwd + half);
      const hi = Math.min(s0 + l - half, total - keepBack - half);
      if (hi >= lo) out.push({ lo, hi });
    }
    s0 += l;
  }
  return out;
}

/** Intersection of two sorted lists of disjoint closed intervals. */
function intersect(a: readonly Interval[], b: readonly Interval[]): Interval[] {
  const out: Interval[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const x = a[i] as Interval;
    const y = b[j] as Interval;
    const lo = Math.max(x.lo, y.lo);
    const hi = Math.min(x.hi, y.hi);
    if (hi >= lo) out.push({ lo, hi });
    if (x.hi < y.hi) i++;
    else j++;
  }
  return out;
}

/**
 * Centres of `n` tabs spaced exactly `total / n` apart by arc length, every one inside `allowed`,
 * or null when no such phase exists. The phase is the middle of the longest feasible phase
 * interval (the first one on a tie within EPS), so every tab is as far as possible from the
 * forbidden zones. Deterministic.
 */
export function evenTabCentres(
  allowed: readonly Interval[],
  total: number,
  n: number,
): number[] | null {
  if (n < 1 || !(total > 0)) return null;
  const sp = total / n;
  let feasible: Interval[] = [{ lo: 0, hi: sp }];
  for (let k = 0; k < n && feasible.length > 0; k++) {
    const shift = k * sp;
    const shifted = allowed
      .map((iv) => ({ lo: Math.max(iv.lo - shift, 0), hi: Math.min(iv.hi - shift, sp) }))
      .filter((iv) => iv.hi >= iv.lo);
    feasible = intersect(feasible, shifted);
  }
  if (feasible.length === 0) return null;
  let best = feasible[0] as Interval;
  for (const iv of feasible) if (iv.hi - iv.lo > best.hi - best.lo + EPS) best = iv;
  const phase = (best.lo + best.hi) / 2;
  return Array.from({ length: n }, (_, k) => phase + k * sp);
}

/**
 * Tabs for a loop: tries `count`, then fewer, down to `minCount`; returns the tabs (raised spans
 * as arc-length intervals and XY ends) and the count placed (0 when even `minCount` does not fit).
 */
export function placeTabs(
  segs: readonly PathSeg[],
  o: {
    count: number;
    width: number;
    toolDiameter: number;
    keepFwd: number;
    keepBack: number;
    minCount: number;
    z: number;
  },
): Tab[] {
  const total = segs.reduce((s, x) => s + segLength(x), 0);
  const half = (o.width + o.toolDiameter) / 2;
  const allowed = tabCentreIntervals(segs, half, o.keepFwd, o.keepBack);
  for (let n = o.count; n >= Math.max(1, o.minCount); n--) {
    // neighbouring raised spans must not touch (n = 1 has no neighbour)
    if (n > 1 && total / n <= 2 * half + EPS) continue;
    const centres = evenTabCentres(allowed, total, n);
    if (!centres) continue;
    return centres.map((c) => {
      const start = c - half;
      const end = c + half;
      const p0 = pointAt(segs, start);
      const p1 = pointAt(segs, end);
      return { centre: c, start, end, x0: p0.x, y0: p0.y, x1: p1.x, y1: p1.y, z: o.z };
    });
  }
  return [];
}

/** XY point at arc length `s` of a path. */
export function pointAt(segs: readonly PathSeg[], s: number): { x: number; y: number } {
  if (s <= 0) {
    const f = segs[0] as PathSeg;
    return { x: f.p0.x, y: f.p0.y };
  }
  const part = slicePath(segs, 0, s);
  const last = part[part.length - 1];
  if (!last) {
    const f = segs[0] as PathSeg;
    return { x: f.p0.x, y: f.p0.y };
  }
  return { x: last.p1.x, y: last.p1.y };
}

/**
 * Moves of one flat pass at depth `z` over the loop with tabs: at each tab the tool rises
 * vertically to the tab top (feed move at the plunge feed), flies the raised span at the cutting
 * feed and goes back down vertically with a plunge at the plunge feed (D-022). The loop ends at P
 * at depth `z`, as without tabs.
 */
export function passMovesWithTabs(
  segs: readonly PathSeg[],
  z: number,
  tabs: readonly Tab[],
  feed: number,
  plungeFeed: number,
): Move[] {
  const total = segs.reduce((s, x) => s + segLength(x), 0);
  const moves: Move[] = [];
  let at = 0;
  for (const t of tabs) {
    moves.push(...pathMoves(slicePath(segs, at, t.start), z, z, feed));
    moves.push({ kind: 'linear', x: t.x0, y: t.y0, z: t.z, feed: plungeFeed });
    const top = pathMoves(slicePath(segs, t.start, t.end), t.z, t.z, feed);
    // pin the exact end point so the descent is vertical
    const lastTop = top[top.length - 1];
    if (lastTop) {
      lastTop.x = t.x1;
      lastTop.y = t.y1;
    }
    moves.push(...top);
    moves.push({ kind: 'plunge', x: t.x1, y: t.y1, z, feed: plungeFeed });
    at = t.end;
  }
  moves.push(...pathMoves(slicePath(segs, at, total), z, z, feed));
  return moves;
}
