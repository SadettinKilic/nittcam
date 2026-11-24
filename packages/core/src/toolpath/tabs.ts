/**
 * Tabs (holding bridges) and small-part auto tabs (spec §6.3, §2.4, §3.6; T015, D-022). Pure.
 *
 * Terms (all along the tool-centre loop of a pass, which starts at the start point P and runs in
 * the travel direction; positions are arc lengths from P):
 * - **width** w: the bridge width left in the material, measured along the contour.
 * - **raised span**: the part of the tool-centre path flown at the tab top. It is `w + D` long
 *   (D = tool diameter): a tool centre at the target depth cuts everything within the tool radius,
 *   so the narrowest part of the bridge (the kerf middle) is the raised span minus D = w.
 * - **height**: the material left in the bridge (what the user types stays, as in VCarve); the
 *   **tab top** is `−(thickness − height)`, independent of the spoilboard allowance.
 */
import { EPS, NOISE } from '../geometry/constants';
import { bbox, signedArea } from '../geometry/polyline';
import type { Polyline } from '../geometry/types';
import { pathMoves, segLength, slicePath, type PathSeg } from './path';
import type { Move, Tab } from './types';

/** Built-in tab defaults, used when the material parameter set has none (D-022). */
export const TAB_DEFAULTS = {
  count: 4,
  /** Bridge width, mm. */
  width: 10,
  /** Built-in default height (material left) at most, mm: height = min(this, t / 2). */
  materialLeft: 3,
  /** Small-part threshold: outline area below this gets auto tabs, mm² (0.05 m²). */
  smallPartArea: 50_000,
  /** Small-part threshold: smaller bounding-box side below this gets auto tabs, mm. */
  smallPartMinSide: 100,
  /** Fewest tabs on an auto-tabbed small part (one tab lets the part pivot). */
  smallPartMinCount: 2,
} as const;

/**
 * Smallest tab that still holds a part (T293, CTO #11 A, D-069; tuned in the field test):
 * bridge width ≥ 3 mm; material left in the bridge ≥ 1 mm and ≤ thickness − 1 mm (a thicker
 * bridge has to be cut, not broken). Below that a "tab" is a cut-free part in disguise.
 */
export const TAB_BOUNDS = {
  minWidth: 3,
  /**
   * T338 (CTO #13 M1, D-129): material beyond the tab's kerf that no other cut removes, mm; less
   * (a neighbour's kerf, the sheet edge) and the tab holds nothing (`tab-hold.ts`).
   */
  minAnchor: 3,
  minHeight: 1,
  /** Height at most thickness minus this, mm. */
  belowThickness: 1,
} as const;

/** Largest allowed tab height on `thickness` mm stock (may be below `minHeight`: no valid tab). */
export function maxTabHeight(thickness: number): number {
  return thickness - TAB_BOUNDS.belowThickness;
}

/** Why a resolved tab size cannot hold a part, or `null` when it can (T293). */
export function tabSizeProblem(
  width: number,
  height: number,
  thickness: number,
): 'width' | 'height' | null {
  const eps = 1e-9;
  if (!(width >= TAB_BOUNDS.minWidth - eps)) return 'width';
  if (!(height >= TAB_BOUNDS.minHeight - eps) || height > maxTabHeight(thickness) + eps) {
    return 'height';
  }
  return null;
}

/**
 * Thinnest and thickest thin skin that still holds a small part (T298, CTO #12 A, D-083; tuned
 * in the field test): skin ≥ 0.2 mm and ≤ thickness − 1 mm. Thinner is a through cut in disguise
 * (the part is free on the last pass); thicker leaves too little for the part's own passes.
 */
export const SKIN_BOUNDS = {
  min: 0.2,
  /** Skin at most thickness minus this, mm. */
  belowThickness: 1,
} as const;

/** Thickest allowed skin on `thickness` mm stock (may be below `SKIN_BOUNDS.min`: no valid skin). */
export function maxSkinThickness(thickness: number): number {
  return thickness - SKIN_BOUNDS.belowThickness;
}

/** Whether a skin of `skin` mm holds a small part on `thickness` mm stock (T298). */
export function skinThicknessOk(skin: number, thickness: number): boolean {
  const eps = 1e-9;
  return skin >= SKIN_BOUNDS.min - eps && skin <= maxSkinThickness(thickness) + eps;
}
/** Built-in default height (material left in the bridge): min(3, t / 2) mm. */
export function defaultTabHeight(thickness: number): number {
  return Math.min(TAB_DEFAULTS.materialLeft, thickness / 2);
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
 * - only on straight segments (with `onArcs`, D-049 cut-out slugs and T272 all-arc outer contours:
 *   also on arcs), at least `half` (= raised span / 2 = w/2 + tool radius) from both ends, so the
 *   raised span never touches a corner or another segment and an arc too short for a tab gets none;
 *   with `minArcRadius` (outer contours: the tool radius) the tool-rounded sharp corners are skipped;
 * - the raised span stays out of `[0, keepFwd]` and `[total − keepBack, total]` (lead-in/out, the
 *   ramp and the plunge point around P).
 */
export function tabCentreIntervals(
  segs: readonly PathSeg[],
  half: number,
  keepFwd: number,
  keepBack: number,
  onArcs = false,
  minArcRadius = 0,
  noCornerArcs = false,
): Interval[] {
  const total = segs.reduce((s, x) => s + segLength(x), 0);
  const corner = noCornerArcs ? cornerArcMask(segs) : null;
  const out: Interval[] = [];
  let s0 = 0;
  for (const [i, s] of segs.entries()) {
    const l = segLength(s);
    if (s.bulge === 0 || (onArcs && arcRadius(s) > minArcRadius + EPS && !(corner?.[i] ?? false))) {
      const lo = Math.max(s0 + half, keepFwd + half);
      const hi = Math.min(s0 + l - half, total - keepBack - half);
      // an exact fit (hi = lo) must not depend on rounding (T273)
      if (hi >= lo - NOISE) out.push({ lo, hi: Math.max(hi, lo) });
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
    if (hi >= lo - NOISE) out.push({ lo, hi: Math.max(hi, lo) });
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
      .filter((iv) => iv.hi >= iv.lo - NOISE)
      .map((iv) => ({ lo: iv.lo, hi: Math.max(iv.hi, iv.lo) }));
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
    /** Tabs may sit on arcs too (D-049 round openings; T272 all-arc outer contours). */
    onArcs?: boolean;
    /**
     * With `onArcs`: only arcs whose radius exceeds this by more than EPS (T272: an outer contour
     * passes the tool radius, so the arc the tool rolls around a sharp corner is never used).
     */
    minArcRadius?: number;
    /**
     * With `onArcs`: skip corner arcs (T284, D-058): a run of co-circular arcs sweeping ≤ 90°
     * next to a straight segment, as the rounded corners of a rectangle.
     */
    noCornerArcs?: boolean;
    /**
     * T338 (D-129): keeps only the tab centres where a tab holds (`holdingCentres`), given the
     * centres the other rules allow. Even spacing is tried first; when the holding positions
     * do not allow it, the tabs spread over them as evenly as they can.
     */
    holding?: ((allowed: readonly Interval[]) => Interval[]) | undefined;
  },
): Tab[] {
  const total = segs.reduce((s, x) => s + segLength(x), 0);
  const half = (o.width + o.toolDiameter) / 2;
  const allowed = tabCentreIntervals(
    segs,
    half,
    o.keepFwd,
    o.keepBack,
    o.onArcs ?? false,
    o.minArcRadius ?? 0,
    o.noCornerArcs ?? false,
  );
  const held = o.holding ? o.holding(allowed) : allowed;
  // Spread only when the holding rule removed positions; else the old even spacing alone (T334).
  const narrowed =
    held.length !== allowed.length ||
    held.some(
      (h, i) =>
        Math.abs(h.lo - (allowed[i]?.lo ?? NaN)) > EPS ||
        Math.abs(h.hi - (allowed[i]?.hi ?? NaN)) > EPS,
    );
  for (let n = o.count; n >= Math.max(1, o.minCount); n--) {
    // neighbouring raised spans must not touch (n = 1 has no neighbour)
    if (n > 1 && total / n <= 2 * half + EPS) continue;
    const centres =
      evenTabCentres(held, total, n) ?? (narrowed ? spreadTabCentres(held, total, n, half) : null);
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

/**
 * T338 (D-129): `n` tab centres inside `allowed` (sorted, disjoint) when even spacing is not
 * possible: the first in the middle of the longest interval, each next one the candidate farthest
 * (around the loop) from those already chosen; raised spans never touch (centres more than
 * `2 · half` apart). Candidates: interval ends, middles and every 0.5 mm. Null when n do not fit.
 * Sorted by arc length. Deterministic.
 */
export function spreadTabCentres(
  allowed: readonly Interval[],
  total: number,
  n: number,
  half: number,
): number[] | null {
  if (n < 1 || allowed.length === 0 || !(total > 0)) return null;
  const cand: number[] = [];
  for (const iv of allowed) {
    const k = Math.max(1, Math.ceil((iv.hi - iv.lo) / 0.5));
    for (let i = 0; i <= k; i++) cand.push(iv.lo + ((iv.hi - iv.lo) * i) / k);
  }
  let first = allowed[0] as Interval;
  for (const iv of allowed) if (iv.hi - iv.lo > first.hi - first.lo + EPS) first = iv;
  const chosen = [(first.lo + first.hi) / 2];
  const gap = (a: number, b: number) => {
    const d = Math.abs(a - b) % total;
    return Math.min(d, total - d);
  };
  while (chosen.length < n) {
    let best: number | null = null;
    let bestD = 2 * half + EPS;
    for (const c of cand) {
      const d = Math.min(...chosen.map((x) => gap(x, c)));
      if (d > bestD + NOISE) {
        best = c;
        bestD = d;
      }
    }
    if (best === null) return null;
    chosen.push(best);
  }
  return chosen.sort((a, b) => a - b);
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

/** Radius of an arc segment (bulge ≠ 0): chord · (1 + b²) / (4 |b|). */
function arcRadius(s: PathSeg): number {
  const b = Math.abs(s.bulge);
  return (Math.hypot(s.p1.x - s.p0.x, s.p1.y - s.p0.y) * (1 + b * b)) / (4 * b);
}

/** Largest sweep of a corner arc run, rad (a quarter turn, with a rounding tolerance). */
const CORNER_SWEEP = Math.PI / 2 + 1e-6;

/** Centre of an arc segment (bulge ≠ 0). */
function arcCentre(s: PathSeg): { x: number; y: number } {
  const dx = s.p1.x - s.p0.x;
  const dy = s.p1.y - s.p0.y;
  // offset from the chord midpoint to the centre, left of travel for b > 0
  const k = (1 - s.bulge * s.bulge) / (4 * s.bulge);
  return { x: (s.p0.x + s.p1.x) / 2 - dy * k, y: (s.p0.y + s.p1.y) / 2 + dx * k };
}

/** Two arc segments lie on one circle and turn the same way. */
function coCircular(a: PathSeg, b: PathSeg): boolean {
  if (a.bulge === 0 || b.bulge === 0 || Math.sign(a.bulge) !== Math.sign(b.bulge)) return false;
  const ra = arcRadius(a);
  const tol = EPS * Math.max(1, ra);
  const ca = arcCentre(a);
  const cb = arcCentre(b);
  return Math.abs(ra - arcRadius(b)) <= tol && Math.hypot(ca.x - cb.x, ca.y - cb.y) <= tol;
}

/**
 * Per segment: true for an arc that is a corner (T284, D-058). Consecutive co-circular arcs form
 * one run (the loop may start inside a run); a run sweeping ≤ 90° with a straight segment on
 * either side is a rounded corner, as on a rounded rectangle. A full circle, a larger sweep
 * (stadium end, half disc) and runs between other arcs only (letter "O") are not corners.
 */
export function cornerArcMask(segs: readonly PathSeg[]): boolean[] {
  const n = segs.length;
  const mask = new Array<boolean>(n).fill(false);
  // start at a run boundary: a segment that does not continue the previous one's circle
  let start = -1;
  for (let i = 0; i < n; i++) {
    const cur = segs[i] as PathSeg;
    if (cur.bulge === 0 || !coCircular(segs[(i - 1 + n) % n] as PathSeg, cur)) {
      start = i;
      break;
    }
  }
  if (start < 0) return mask; // one full circle
  let k = 0;
  while (k < n) {
    const i = (start + k) % n;
    const s = segs[i] as PathSeg;
    if (s.bulge === 0) {
      k++;
      continue;
    }
    const run = [i];
    let last = s;
    let sweep = 4 * Math.atan(Math.abs(s.bulge));
    while (k + run.length < n) {
      const j = (start + k + run.length) % n;
      const nx = segs[j] as PathSeg;
      if (!coCircular(last, nx)) break;
      run.push(j);
      last = nx;
      sweep += 4 * Math.atan(Math.abs(nx.bulge));
    }
    const before = segs[(i - 1 + n) % n] as PathSeg;
    const after = segs[((run[run.length - 1] as number) + 1) % n] as PathSeg;
    if (sweep <= CORNER_SWEEP && (before.bulge === 0 || after.bulge === 0))
      for (const j of run) mask[j] = true;
    k += run.length;
  }
  return mask;
}
