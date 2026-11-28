/**
 * Cut order and rapid ordering (spec §6.3, §6.2, §4.5; T016, D-023). Pure and deterministic.
 *
 * Works on abstract items (one per operation) so the rules hold for operation kinds that M1 does
 * not cut yet (holes, pockets, grooves, inner contours) and for several tools:
 *
 * - **Hard constraints** (never broken): within one part copy, holes/pockets/grooves → inner
 *   contours → outer contour; outer contours in non-decreasing outline area (small parts first,
 *   while the vacuum is strong). In `minToolChanges` the area rule holds only between outer
 *   contours of the same tool, so each tool can run as one block.
 * - **Greedy list schedule** per sheet (each sheet is its own program): among the ready items
 *   prefer the current tool (tool grouping), then the lower class (holes, inner, outer), then the
 *   smaller area, then the nearest start point from where the tool is (nearest neighbour from the
 *   sheet origin), then the input order. A tool change happens only when no ready item uses the
 *   current tool; the next tool is the one of the best ready item ("first needed").
 * - **Start points:** every item offers one or more start points (a contour ends where it starts).
 *   For a fixed order the best choice is found exactly by dynamic programming over the candidates.
 * - **2-opt** inside runs of consecutive items with the same tool, class and (outer) area. Any
 *   permutation of such a run keeps every constraint, so the pass can never break one. Bounded by
 *   an evaluation budget.
 * - The result is never longer than the naive constrained order (ties by input order, first start
 *   point): the pass starts from the shorter of the greedy tour and the naive one.
 */
import type { Point } from '../geometry/types';
import type { NestingMode } from '../schema';

/** Operation classes; drill/pocket/groove are the holes of §4.5. */
export type CutClass = 'drill' | 'pocket' | 'groove' | 'online' | 'vgroove' | 'inner' | 'outer';

/** Holes and pockets first, then inner contours, the outer contour last (§6.3, §4.5). */
export const CUT_CLASS_RANK: Record<CutClass, number> = {
  drill: 0,
  pocket: 0,
  groove: 0,
  // On-line engraving (T142) never frees anything: with the holes, before every through cut.
  online: 0,
  // T353: V-grooves (folds) before any contour of the same part, while it is still held.
  vgroove: 0,
  inner: 1,
  outer: 2,
};

export type CutOrderMode = NestingMode;

export interface OrderItem {
  sheet: number;
  /** Part copy key (`<partId>#<copy>`): the within-part rule applies to items sharing it. */
  part: string;
  cls: CutClass;
  tool: number;
  /** Outline area, mm² (used for outer contours: small first). */
  area: number;
  /** Allowed start points (non-empty); the first one is the default. The item ends where it starts. */
  starts: readonly Point[];
  /**
   * Part-in-hole (T166): the copy key of the host whose inner cutout this copy sits in. Every item
   * of this copy is cut before the host's inner contours (cutting them frees the slug).
   */
  within?: string | undefined;
}

export interface CutOrderOptions {
  mode: CutOrderMode;
  /** 2-opt tour evaluations per sheet (default per mode, `CUT_ORDER_DEFAULTS`). 0 = no 2-opt. */
  maxEvaluations?: number;
  /** Where the tool is before the first item of every sheet. Default: the sheet origin. */
  origin?: Point;
}

export interface OrderedItem {
  /** Index into the input items. */
  item: number;
  /** Index into the item's `starts`. */
  start: number;
}

export interface SheetOrderStats {
  sheet: number;
  /** Rapid XY length of the input order with default start points (T014 order), mm. */
  placementRapid: number;
  /** Rapid XY length of the naive constrained order (ties by input order, default starts), mm. */
  naiveRapid: number;
  /** Rapid XY length of the result, mm. */
  rapid: number;
  toolChanges: number;
  evaluations: number;
}

export interface CutOrderResult {
  mode: CutOrderMode;
  /** Every input item exactly once, sheet by sheet. */
  sequence: OrderedItem[];
  placementRapid: number;
  naiveRapid: number;
  rapid: number;
  toolChanges: number;
  sheets: SheetOrderStats[];
}

export const CUT_ORDER_DEFAULTS = {
  /** 2-opt evaluation budget per sheet and mode. */
  maxEvaluations: { minWaste: 20_000, fastest: 100_000, minToolChanges: 20_000 },
} as const;

/** Improvements smaller than this (mm) are ignored, so float noise cannot loop or flip ties. */
const IMPROVE_EPS = 1e-9;

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** True when `a` must be cut before `b` (same sheet assumed). */
export function mustPrecede(a: OrderItem, b: OrderItem, mode: CutOrderMode): boolean {
  const ra = CUT_CLASS_RANK[a.cls];
  const rb = CUT_CLASS_RANK[b.cls];
  if (a.part === b.part && ra < rb) return true;
  if (a.within !== undefined && a.within === b.part && b.cls === 'inner') return true;
  if (a.cls === 'outer' && b.cls === 'outer' && a.area < b.area) {
    return mode !== 'minToolChanges' || a.tool === b.tool;
  }
  return false;
}

/** Rapid XY length of a sequence with chosen starts, from `origin`. */
export function rapidLength(
  items: readonly OrderItem[],
  seq: readonly OrderedItem[],
  origin: Point,
): number {
  let pos = origin;
  let sum = 0;
  for (const o of seq) {
    const p = (items[o.item] as OrderItem).starts[o.start] as Point;
    sum += dist(pos, p);
    pos = p;
  }
  return sum;
}

/** Number of tool changes in a sequence (the first tool is not a change). */
export function toolChanges(items: readonly OrderItem[], seq: readonly OrderedItem[]): number {
  let n = 0;
  for (let i = 1; i < seq.length; i++) {
    if (
      (items[(seq[i] as OrderedItem).item] as OrderItem).tool !==
      (items[(seq[i - 1] as OrderedItem).item] as OrderItem).tool
    )
      n++;
  }
  return n;
}

/**
 * Greedy list schedule of one sheet's items (indices in input order). `nearest` = use the distance
 * key (nearest neighbour); otherwise ties fall to the input order (the naive constrained order).
 * `toolPref` = the order in which tools are picked at a tool change (and for the first tool).
 */
function schedule(
  items: readonly OrderItem[],
  idx: readonly number[],
  mode: CutOrderMode,
  origin: Point,
  nearest: boolean,
  toolPref?: readonly number[],
): number[] {
  const n = idx.length;
  const preds: number[] = new Array<number>(n).fill(0);
  const succ: number[][] = idx.map(() => []);
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      if (
        a !== b &&
        mustPrecede(
          items[idx[a] as number] as OrderItem,
          items[idx[b] as number] as OrderItem,
          mode,
        )
      ) {
        (succ[a] as number[]).push(b);
        preds[b] = (preds[b] as number) + 1;
      }
    }
  }
  const done: boolean[] = new Array<boolean>(n).fill(false);
  const out: number[] = [];
  let tool: number | null = null;
  let pos = origin;
  for (let step = 0; step < n; step++) {
    let best = -1;
    let bestKey: number[] = [];
    let bestPoint = origin;
    for (let k = 0; k < n; k++) {
      if (done[k] || (preds[k] as number) > 0) continue;
      const it = items[idx[k] as number] as OrderItem;
      let d = 0;
      let point = it.starts[0] as Point;
      if (nearest) {
        d = Infinity;
        for (const s of it.starts) {
          const ds = dist(pos, s);
          if (ds < d) {
            d = ds;
            point = s;
          }
        }
      }
      const key = [
        // Current tool first; at a change (or the first tool) the preferred order, if any (B51).
        it.tool === tool
          ? 0
          : tool === null && !toolPref
            ? 0
            : 1 + (toolPref?.indexOf(it.tool) ?? 0),
        CUT_CLASS_RANK[it.cls],
        it.cls === 'outer' ? it.area : 0,
        d,
      ];
      let better = best < 0;
      if (!better) {
        for (let q = 0; q < key.length; q++) {
          const kq = key[q] as number;
          const bq = bestKey[q] as number;
          if (kq !== bq) {
            better = kq < bq;
            break;
          }
        }
      }
      if (better) {
        best = k;
        bestKey = key;
        bestPoint = point;
      }
    }
    // A precedence cycle cannot happen (class rank and area are strict orders), so a ready item exists.
    done[best] = true;
    out.push(best);
    for (const s of succ[best] as number[]) preds[s] = (preds[s] as number) - 1;
    tool = (items[idx[best] as number] as OrderItem).tool;
    pos = bestPoint;
  }
  return out.map((k) => idx[k] as number);
}

/**
 * Optimal start points for a fixed order (Viterbi over the candidates). `f[i][c]` = shortest rapid
 * length from the origin through item i entered at candidate c.
 */
interface Dp {
  f: number[][];
  from: number[][];
}

function dpFrom(
  items: readonly OrderItem[],
  order: readonly number[],
  origin: Point,
  dp: Dp,
  i0: number,
): number {
  for (let i = i0; i < order.length; i++) {
    const cur = (items[order[i] as number] as OrderItem).starts;
    const fi: number[] = [];
    const fromI: number[] = [];
    if (i === 0) {
      cur.forEach((s) => {
        fi.push(dist(origin, s));
        fromI.push(-1);
      });
    } else {
      const prev = (items[order[i - 1] as number] as OrderItem).starts;
      const fp = dp.f[i - 1] as number[];
      cur.forEach((s) => {
        let bestV = Infinity;
        let bestC = 0;
        prev.forEach((ps, c) => {
          const v = (fp[c] as number) + dist(ps, s);
          if (v < bestV) {
            bestV = v;
            bestC = c;
          }
        });
        fi.push(bestV);
        fromI.push(bestC);
      });
    }
    dp.f[i] = fi;
    dp.from[i] = fromI;
  }
  dp.f.length = order.length;
  dp.from.length = order.length;
  return dpTotal(dp);
}

function dpTotal(dp: Dp): number {
  const last = dp.f[dp.f.length - 1];
  return last ? Math.min(...last) : 0;
}

function dpStarts(dp: Dp): number[] {
  const n = dp.f.length;
  const out: number[] = new Array<number>(n).fill(0);
  if (n === 0) return out;
  const last = dp.f[n - 1] as number[];
  let c = 0;
  last.forEach((v, k) => {
    if (v < (last[c] as number)) c = k;
  });
  for (let i = n - 1; i >= 0; i--) {
    out[i] = c;
    c = (dp.from[i] as number[])[c] as number;
  }
  return out;
}

/** Runs [s, e] (inclusive) of consecutive items that may be permuted freely. */
function runs(items: readonly OrderItem[], order: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  const same = (a: OrderItem, b: OrderItem) =>
    a.tool === b.tool &&
    CUT_CLASS_RANK[a.cls] === CUT_CLASS_RANK[b.cls] &&
    (a.cls !== 'outer' || b.cls !== 'outer' || a.area === b.area) &&
    (a.cls === 'outer') === (b.cls === 'outer') &&
    // A guest and its host's inner never share a run (T166).
    a.within === b.within;
  let s = 0;
  for (let i = 1; i <= order.length; i++) {
    if (
      i === order.length ||
      !same(items[order[i] as number] as OrderItem, items[order[s] as number] as OrderItem)
    ) {
      if (i - 1 > s) out.push([s, i - 1]);
      s = i;
    }
  }
  return out;
}

/** 2-opt (segment reversal) inside the free runs, first improvement, bounded by `budget`. */
function twoOpt(
  items: readonly OrderItem[],
  order: number[],
  origin: Point,
  budget: number,
): { order: number[]; dp: Dp; evaluations: number } {
  const dp: Dp = { f: [], from: [] };
  let best = dpFrom(items, order, origin, dp, 0);
  let evaluations = 0;
  const free = runs(items, order);
  const trial: Dp = { f: [], from: [] };
  let improved = true;
  while (improved && evaluations < budget) {
    improved = false;
    for (const [s, e] of free) {
      for (let i = s; i < e && evaluations < budget; i++) {
        for (let j = i + 1; j <= e && evaluations < budget; j++) {
          const cand = order.slice();
          let a = i;
          let b = j;
          while (a < b) {
            const t = cand[a] as number;
            cand[a] = cand[b] as number;
            cand[b] = t;
            a++;
            b--;
          }
          trial.f = dp.f.slice(0, i);
          trial.from = dp.from.slice(0, i);
          evaluations++;
          const v = dpFrom(items, cand, origin, trial, i);
          if (v < best - IMPROVE_EPS) {
            best = v;
            order = cand;
            dp.f = trial.f.slice();
            dp.from = trial.from.slice();
            improved = true;
          }
        }
      }
    }
  }
  return { order, dp, evaluations };
}

/** Tool changes of an order of item indices. */
function changesOf(items: readonly OrderItem[], order: readonly number[]): number {
  let n = 0;
  for (let i = 1; i < order.length; i++) {
    if (
      (items[order[i] as number] as OrderItem).tool !==
      (items[order[i - 1] as number] as OrderItem).tool
    )
      n++;
  }
  return n;
}

/** All orderings of `xs` (lexicographic by input order). */
function permutations(xs: readonly number[]): number[][] {
  if (xs.length <= 1) return [xs.slice()];
  const out: number[][] = [];
  xs.forEach((x, i) => {
    for (const rest of permutations([...xs.slice(0, i), ...xs.slice(i + 1)]))
      out.push([x, ...rest]);
  });
  return out;
}

/** Up to this many tools on one sheet every tool order is tried (5! = 120 greedy runs). */
const MAX_TOOL_ORDER_SEARCH = 5;

/**
 * B51 (D-091, CTO #7): the "first needed" tool choice can make a change too many (T2 → T3 → T2 when
 * T3 drills holes the T2 outer contour waits for; T3 → T2 is enough). Tries the greedy schedule
 * with every order of the sheet's tools at a change and returns the order with the fewest changes
 * (ties: the shorter rapid, then the first order), or undefined when none beats the plain greedy
 * schedule. Constraints still hold: every candidate is a list schedule over the same precedence.
 */
function toolPreference(
  items: readonly OrderItem[],
  idx: readonly number[],
  mode: CutOrderMode,
  origin: Point,
): number[] | undefined {
  const tools = [...new Set(idx.map((i) => (items[i] as OrderItem).tool))].sort((a, b) => a - b);
  if (tools.length < 2 || tools.length > MAX_TOOL_ORDER_SEARCH) return undefined;
  let bestChanges = changesOf(items, schedule(items, idx, mode, origin, true));
  // Every tool runs at least once: fewer than (tools - 1) changes is impossible.
  if (bestChanges <= tools.length - 1) return undefined;
  let best: number[] | undefined;
  let bestRapid = Infinity;
  for (const pref of permutations(tools)) {
    const cand = schedule(items, idx, mode, origin, true, pref);
    const c = changesOf(items, cand);
    if (c > bestChanges || (c === bestChanges && !best)) continue;
    const r = dpFrom(items, cand, origin, { f: [], from: [] }, 0);
    if (c < bestChanges || r < bestRapid - IMPROVE_EPS) {
      best = pref;
      bestChanges = c;
      bestRapid = r;
    }
  }
  return best;
}

/**
 * Cut order of `items` (spec §6.3). Items are processed sheet by sheet (ascending sheet index);
 * within a sheet the input order is the naive order and the final tie-break.
 */
export function cutOrder(items: readonly OrderItem[], options: CutOrderOptions): CutOrderResult {
  const { mode } = options;
  const origin = options.origin ?? { x: 0, y: 0 };
  const budget = options.maxEvaluations ?? CUT_ORDER_DEFAULTS.maxEvaluations[mode];
  const bySheet = new Map<number, number[]>();
  items.forEach((it, i) => {
    const list = bySheet.get(it.sheet);
    if (list) list.push(i);
    else bySheet.set(it.sheet, [i]);
  });
  const sheetIds = [...bySheet.keys()].sort((a, b) => a - b);
  const sequence: OrderedItem[] = [];
  const sheets: SheetOrderStats[] = [];
  const defaults = (order: readonly number[]) => order.map((item) => ({ item, start: 0 }));
  for (const sheet of sheetIds) {
    const idx = bySheet.get(sheet) as number[];
    const placementRapid = rapidLength(items, defaults(idx), origin);
    const pref = toolPreference(items, idx, mode, origin);
    const naive = schedule(items, idx, mode, origin, false, pref);
    const naiveRapid = rapidLength(items, defaults(naive), origin);
    const greedy = schedule(items, idx, mode, origin, true, pref);
    const dpG: Dp = { f: [], from: [] };
    const dpN: Dp = { f: [], from: [] };
    const g = dpFrom(items, greedy, origin, dpG, 0);
    const nv = dpFrom(items, naive, origin, dpN, 0);
    const startOrder = g <= nv ? greedy : naive;
    const opt = twoOpt(items, startOrder.slice(), origin, budget);
    const starts = dpStarts(opt.dp);
    const seq = opt.order.map((item, i) => ({ item, start: starts[i] as number }));
    sequence.push(...seq);
    sheets.push({
      sheet,
      placementRapid,
      naiveRapid,
      rapid: rapidLength(items, seq, origin),
      toolChanges: toolChanges(items, seq),
      evaluations: opt.evaluations,
    });
  }
  const total = (k: 'placementRapid' | 'naiveRapid' | 'rapid' | 'toolChanges') =>
    sheets.reduce((s, x) => s + x[k], 0);
  return {
    mode,
    sequence,
    placementRapid: total('placementRapid'),
    naiveRapid: total('naiveRapid'),
    rapid: total('rapid'),
    toolChanges: total('toolChanges'),
    sheets,
  };
}
