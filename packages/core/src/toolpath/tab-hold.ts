/**
 * Tabs that hold (T338, CTO #13 M1, D-129). Pure.
 *
 * A tab is material left in the part's own kerf. It holds only when it is attached to something:
 * beyond its kerf there must be at least `TAB_BOUNDS.minAnchor` mm of material that no other
 * cutting move of the sheet removes (any part's contour, lead, ramp, pocket, hole or line, at a
 * depth that reaches the tab), and the sheet edge holds nothing. At the default clearance between
 * parts (tool Ø + 0.1 mm, D-104) a neighbour's kerf overlaps the own kerf almost completely, so a
 * tab on a side facing a neighbour is cut away by the neighbour's pass.
 *
 * The region a tab needs, for a tab centred at arc length `c` on the tool-centre loop with width
 * `w` and tool radius `r`: for every s in [c − w/2, c + w/2] the "spoke" from the tool-centre
 * point P(s) along the outward normal n(s) (away from the held piece), from P − n·r (the part
 * edge) to P + n·(r + anchor). Every spoke must lie on the sheet and keep more than a cutter's
 * radius (plus a small slack) from every other cutting move.
 */
import { EPS, NOISE } from '../geometry/constants';
import { arcOf, bulgeToSweep } from '../geometry/segment';
import { TAB_BOUNDS, type Interval } from './tabs';
import type { PathSeg } from './path';
import { segLength } from './path';
import type { Operation, SegmentRole } from './types';

/** Material beyond the tab's kerf that must stay (mm, proposal of CTO #13, D-129). */
export const TAB_ANCHOR = TAB_BOUNDS.minAnchor;
/** Distance slack of the generator's test (mm): it is stricter than the checker's own. */
const SLACK = 0.005;
/** Chord error allowed when an arc move is replaced by chords (mm); added to the cutter radius. */
const ARC_TOL = 0.01;

/** One cutting move as a capsule: the tool centre runs from a to b with radius r. */
export interface Cutter {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  r: number;
  /** Operation the move belongs to. */
  op: string;
  /** False for the operation's own lead-in/out (they count for its own tabs, D-129). */
  pass: boolean;
  /**
   * T373: the move belongs to the entry or exit (lead-in/out, the plunge and the retract at their
   * ends). Set by `cuttersOf`; such moves can be shortened to spare a neighbour's tab.
   */
  lead?: true;
}

/** Cutters of a sheet bucketed on a grid for nearby queries. */
export interface CutterIndex {
  cell: number;
  cells: Map<string, Cutter[]>;
  /** Sheet size: the region outside holds nothing. */
  sheet: { width: number; height: number };
}

/**
 * The cutting moves of `ops` that reach down to `zLimit` (a tab top) or below, as capsules. Every
 * feed move counts (rapids too, if one ever went below the top), arcs as chords.
 */
export function cuttersOf(ops: readonly Operation[], zLimit: number): Cutter[] {
  const out: Cutter[] = [];
  const seen = new Set<string>();
  for (const op of ops) {
    const r = op.toolDiameter / 2;
    let prev: { x: number; y: number; z: number } | null = null;
    for (const seg of op.segments) {
      const pass = !(seg.role === 'leadIn' || seg.role === 'leadOut');
      const lead =
        !pass || seg.role === 'approach' || seg.role === 'retract' ? { lead: true as const } : {};
      for (const m of seg.moves) {
        const from = prev;
        prev = { x: m.x, y: m.y, z: m.z };
        if (!from) continue;
        const deep = Math.min(from.z, m.z) <= zLimit + EPS;
        if (!deep || (m.kind === 'rapid' && Math.min(from.z, m.z) >= 0)) continue;
        const add = (ax: number, ay: number, bx: number, by: number, rr: number) => {
          const key = `${op.id}|${pass}|${ax.toFixed(4)},${ay.toFixed(4)},${bx.toFixed(4)},${by.toFixed(4)},${rr}`;
          if (seen.has(key)) return;
          seen.add(key);
          out.push({ ax, ay, bx, by, r: rr, op: op.id, pass, ...lead });
        };
        if (m.kind === 'arc') {
          const rad = Math.hypot(from.x - m.cx, from.y - m.cy);
          const sweep = 4 * Math.atan(m.bulge);
          // chord count so the sagitta stays below ARC_TOL
          const maxStep = rad > ARC_TOL ? 2 * Math.acos(1 - ARC_TOL / rad) : Math.PI;
          const n = Math.max(1, Math.ceil(Math.abs(sweep) / maxStep));
          const a0 = Math.atan2(from.y - m.cy, from.x - m.cx);
          let px = from.x;
          let py = from.y;
          for (let k = 1; k <= n; k++) {
            const a = a0 + (sweep * k) / n;
            const qx = k === n ? m.x : m.cx + rad * Math.cos(a);
            const qy = k === n ? m.y : m.cy + rad * Math.sin(a);
            add(px, py, qx, qy, r + ARC_TOL);
            px = qx;
            py = qy;
          }
        } else {
          add(from.x, from.y, m.x, m.y, r);
        }
      }
    }
  }
  return out;
}

const keyOf = (i: number, j: number) => `${i},${j}`;

export function cutterIndex(
  cutters: readonly Cutter[],
  sheet: { width: number; height: number },
  cell = 25,
): CutterIndex {
  const cells = new Map<string, Cutter[]>();
  for (const c of cutters) {
    const g = c.r + SLACK;
    const i0 = Math.floor((Math.min(c.ax, c.bx) - g) / cell);
    const i1 = Math.floor((Math.max(c.ax, c.bx) + g) / cell);
    const j0 = Math.floor((Math.min(c.ay, c.by) - g) / cell);
    const j1 = Math.floor((Math.max(c.ay, c.by) + g) / cell);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = keyOf(i, j);
        const list = cells.get(k);
        if (list) list.push(c);
        else cells.set(k, [c]);
      }
    }
  }
  return { cell, cells, sheet };
}

function pointSegDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** Distance between two segments in the plane (0 when they cross). */
export function segSegDist(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
): number {
  const d1 = cross(ax, ay, bx, by, cx, cy);
  const d2 = cross(ax, ay, bx, by, dx, dy);
  const d3 = cross(cx, cy, dx, dy, ax, ay);
  const d4 = cross(cx, cy, dx, dy, bx, by);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return 0;
  }
  return Math.min(
    pointSegDist(ax, ay, cx, cy, dx, dy),
    pointSegDist(bx, by, cx, cy, dx, dy),
    pointSegDist(cx, cy, ax, ay, bx, by),
    pointSegDist(dx, dy, ax, ay, bx, by),
  );
}

/**
 * Whether the spoke from (ax, ay) to (bx, by) is material that stays: on the sheet and clear of
 * every cutter except the passes of operation `own` (its own kerf).
 */
export function spokeClear(
  index: CutterIndex,
  own: string,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): boolean {
  const { width, height } = index.sheet;
  const on = (x: number, y: number) =>
    x >= -NOISE && y >= -NOISE && x <= width + NOISE && y <= height + NOISE;
  if (!on(ax, ay) || !on(bx, by)) return false;
  const cell = index.cell;
  const i0 = Math.floor(Math.min(ax, bx) / cell);
  const i1 = Math.floor(Math.max(ax, bx) / cell);
  const j0 = Math.floor(Math.min(ay, by) / cell);
  const j1 = Math.floor(Math.max(ay, by) / cell);
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      for (const c of index.cells.get(keyOf(i, j)) ?? []) {
        if (c.op === own && c.pass) continue;
        if (segSegDist(ax, ay, bx, by, c.ax, c.ay, c.bx, c.by) < c.r + SLACK) return false;
      }
    }
  }
  return true;
}

/** Point and unit tangent at arc length `s` of a path. */
export function pointTangentAt(
  segs: readonly PathSeg[],
  s: number,
): { x: number; y: number; tx: number; ty: number } {
  let at = s;
  for (const [k, seg] of segs.entries()) {
    const l = segLength(seg);
    if (at <= l || k === segs.length - 1) {
      const f = l > 0 ? Math.max(0, Math.min(1, at / l)) : 0;
      const arc = arcOf(seg.p0, seg.p1, seg.bulge);
      if (!arc) {
        const len = Math.hypot(seg.p1.x - seg.p0.x, seg.p1.y - seg.p0.y) || 1;
        return {
          x: seg.p0.x + (seg.p1.x - seg.p0.x) * f,
          y: seg.p0.y + (seg.p1.y - seg.p0.y) * f,
          tx: (seg.p1.x - seg.p0.x) / len,
          ty: (seg.p1.y - seg.p0.y) / len,
        };
      }
      const sweep = bulgeToSweep(seg.bulge);
      const ang = arc.startAngle + sweep * f;
      const ux = Math.cos(ang);
      const uy = Math.sin(ang);
      return {
        x: arc.center.x + arc.radius * ux,
        y: arc.center.y + arc.radius * uy,
        tx: sweep > 0 ? -uy : uy,
        ty: sweep > 0 ? ux : -ux,
      };
    }
    at -= l;
  }
  const f = segs[0] as PathSeg;
  return { x: f.p0.x, y: f.p0.y, tx: 1, ty: 0 };
}

export interface HoldOptions {
  /** Tab width (material along the contour), mm. */
  width: number;
  toolRadius: number;
  /** The loop runs counter-clockwise (the held piece on its left). */
  ccw: boolean;
  index: CutterIndex;
  /** This operation's id: its own passes do not count against its tabs. */
  own: string;
  /** Material beyond the kerf, mm (default `TAB_ANCHOR`). */
  anchor?: number;
}

/** The spoke of the tab region at arc length `s` (see the module comment). */
function spokeAt(
  segs: readonly PathSeg[],
  s: number,
  o: Pick<HoldOptions, 'ccw' | 'toolRadius' | 'anchor'>,
) {
  const p = pointTangentAt(segs, s);
  // outward normal: right of travel on a CCW loop, left on a CW loop
  const nx = o.ccw ? p.ty : -p.ty;
  const ny = o.ccw ? -p.tx : p.tx;
  const out = o.toolRadius + (o.anchor ?? TAB_ANCHOR);
  return {
    ax: p.x - nx * o.toolRadius,
    ay: p.y - ny * o.toolRadius,
    bx: p.x + nx * out,
    by: p.y + ny * out,
  };
}

/** Sample step along the loop: at most half a cutter radius, so no cutter slips between spokes. */
function stepOf(o: Pick<HoldOptions, 'toolRadius'>): number {
  return Math.min(0.5, Math.max(0.05, o.toolRadius / 2));
}

/**
 * The core predicate (D-129): the tab centred at arc length `centre` holds. Pure; exact at the
 * sampled spokes (step ≤ 0.5 mm, ≤ r/2) and at both ends of the tab.
 */
export function tabHolds(segs: readonly PathSeg[], centre: number, o: HoldOptions): boolean {
  const h = stepOf(o);
  const lo = centre - o.width / 2;
  const hi = centre + o.width / 2;
  const n = Math.max(1, Math.ceil((hi - lo) / h));
  for (let k = 0; k <= n; k++) {
    const sp = spokeAt(segs, lo + ((hi - lo) * k) / n, o);
    if (!spokeClear(o.index, o.own, sp.ax, sp.ay, sp.bx, sp.by)) return false;
  }
  return true;
}

/**
 * The tab centres inside `within` (sorted, disjoint) whose tab holds. A blocked spoke at s rules
 * out every centre within w/2 + step of it, so a centre returned holds at every spoke
 * (conservative by one sample step).
 */
export function holdingCentres(
  segs: readonly PathSeg[],
  within: readonly Interval[],
  o: HoldOptions,
): Interval[] {
  const h = stepOf(o);
  const half = o.width / 2;
  const out: Interval[] = [];
  for (const iv of within) {
    const from = iv.lo - half;
    const to = iv.hi + half;
    const n = Math.max(1, Math.ceil((to - from) / h));
    const blocked: Interval[] = [];
    for (let k = 0; k <= n; k++) {
      const s = from + ((to - from) * k) / n;
      const sp = spokeAt(segs, s, o);
      if (spokeClear(o.index, o.own, sp.ax, sp.ay, sp.bx, sp.by)) continue;
      const b = { lo: s - half - h, hi: s + half + h };
      const last = blocked[blocked.length - 1];
      if (last && b.lo <= last.hi) last.hi = Math.max(last.hi, b.hi);
      else blocked.push(b);
    }
    let lo = iv.lo;
    for (const b of blocked) {
      if (b.lo > lo) {
        const hi = Math.min(b.lo, iv.hi);
        if (hi >= lo) out.push({ lo, hi });
      }
      lo = Math.max(lo, b.hi);
      if (lo > iv.hi) break;
    }
    if (lo <= iv.hi) out.push({ lo, hi: iv.hi });
  }
  // a single point that survived exactly at a boundary is no room for a tab
  return out.filter((x) => x.hi - x.lo > NOISE || within.some((w) => w.hi - w.lo <= NOISE));
}

/**
 * T373 (D-146): the region a placed tab needs (its spokes, see the module comment) as zero-radius
 * "cutters" of operation `op`, sampled like `tabHolds` (both ends included). A neighbour's lead
 * that comes within its cutter radius of one of them cuts into the tab's web.
 */
export function tabZone(
  segs: readonly PathSeg[],
  from: number,
  to: number,
  o: Pick<HoldOptions, 'ccw' | 'toolRadius' | 'anchor'> & { op: string },
): Cutter[] {
  const h = stepOf(o);
  const n = Math.max(1, Math.ceil((to - from) / h));
  const out: Cutter[] = [];
  for (let k = 0; k <= n; k++) {
    const sp = spokeAt(segs, from + ((to - from) * k) / n, o);
    out.push({ ...sp, r: 0, op: o.op, pass: true });
  }
  return out;
}

/** A lead (or any path segment) as cutter capsules of operation `op`, arcs as chords. */
export function pathSegCutters(seg: PathSeg, r: number, op: string): Cutter[] {
  const arc = arcOf(seg.p0, seg.p1, seg.bulge);
  if (!arc) {
    return [{ ax: seg.p0.x, ay: seg.p0.y, bx: seg.p1.x, by: seg.p1.y, r, op, pass: false }];
  }
  const sweep = bulgeToSweep(seg.bulge);
  const rad = arc.radius;
  const maxStep = rad > ARC_TOL ? 2 * Math.acos(1 - ARC_TOL / rad) : Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / maxStep));
  const out: Cutter[] = [];
  let px = seg.p0.x;
  let py = seg.p0.y;
  for (let k = 1; k <= n; k++) {
    const a = arc.startAngle + (sweep * k) / n;
    const qx = k === n ? seg.p1.x : arc.center.x + rad * Math.cos(a);
    const qy = k === n ? seg.p1.y : arc.center.y + rad * Math.sin(a);
    out.push({ ax: px, ay: py, bx: qx, by: qy, r: r + ARC_TOL, op, pass: false });
    px = qx;
    py = qy;
  }
  return out;
}

/**
 * T373 (D-146): whether one of `cutters` (a lead's capsules) cuts into the region of a tab of
 * another operation in `zones` (an index of `tabZone` spokes).
 */
export function cutsIntoTabs(zones: CutterIndex, own: string, cutters: readonly Cutter[]): boolean {
  const cell = zones.cell;
  for (const c of cutters) {
    const g = c.r + SLACK;
    const i0 = Math.floor((Math.min(c.ax, c.bx) - g) / cell);
    const i1 = Math.floor((Math.max(c.ax, c.bx) + g) / cell);
    const j0 = Math.floor((Math.min(c.ay, c.by) - g) / cell);
    const j1 = Math.floor((Math.max(c.ay, c.by) + g) / cell);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        for (const z of zones.cells.get(keyOf(i, j)) ?? []) {
          if (z.op === own) continue;
          if (segSegDist(c.ax, c.ay, c.bx, c.by, z.ax, z.ay, z.bx, z.by) < g) return true;
        }
      }
    }
  }
  return false;
}

/** Roles whose moves are an operation's own lead (`Cutter.pass` false). */
export const LEAD_ROLES: ReadonlySet<SegmentRole> = new Set(['leadIn', 'leadOut']);
