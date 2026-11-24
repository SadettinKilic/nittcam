/**
 * True-shape placer (T165, spec §6.2 v3, D-034): deterministic bottom-left placement of real
 * footprints (`shape.ts`) with exact polygon overlap tests and a uniform-grid spatial index.
 * Pure: no clock, no randomness; every list is iterated in a fixed order.
 *
 * Per copy and sheet: candidate positions are x ∈ {margin} ∪ {right edge of every placed
 * footprint} and, per x, y ∈ {margin} ∪ {top edge of every placed footprint over that x}; the
 * lowest valid y per x is kept. Candidates rank by (top of the part, x, rotation order). The best
 * few are compacted (slid down, left, down by bisection over valid positions, so true shapes
 * interlock) and the best result wins. A copy goes on the first sheet that takes it; otherwise a
 * new sheet opens.
 *
 * T306: when every copy is placed, a tidy pass puts each new placement position on the 0.001 mm
 * grid (the nudge and bisection residue reached the 4-decimal Mach3 output as X522.0001), only
 * where the moved footprint stays on the sheet and overlaps nothing; else it stays. A position
 * moves by less than 0.001 mm; sheet counts, order and rotations never change. A part's own
 * geometry (a rotated outline's real decimals) is not touched, nor is the post's rounding.
 */
import { EPS } from '../geometry/constants';
import type { Placement } from '../schema';
import { footprintsOverlap, moveFootprint, type Footprint, type ShapeOption } from './shape';
import type { UnplacedPart } from './types';

/** One copy for the true-shape placer: its footprints per allowed rotation, in rotation order. */
export interface ShapeItem {
  partId: string;
  index: number;
  options: readonly ShapeOption[];
  /** Outline area, mm² (stock choice and the free-area pre-check). */
  area: number;
}

export interface ShapeSheetSize {
  width: number;
  height: number;
  qty?: number | undefined;
  offcutId?: string | undefined;
}

export interface ShapePackInput {
  dims: readonly ShapeSheetSize[];
  margin: number;
  /** Locked sheets in order: their size index and obstacle footprints (sheet frame). */
  locked: readonly { size: number; obstacles: readonly Footprint[] }[];
}

export interface ShapePacked {
  /** New placements per sheet (locked ones not included). */
  sheets: Placement[][];
  sizeOf: number[];
  unplaced: UnplacedPart[];
}

/** How many of the best uncompacted candidates are compacted (plus the best per rotation). */
const COMPACT_TOP = 3;
/** Bisection steps of one slide (precision ≈ sheet size / 2^steps). */
const SLIDE_STEPS = 14;
/** Grid cells per sheet side of the spatial index. */
const GRID = 16;
/** Candidates next to a footprint start this far off it (mm), so float noise never reads touching as overlap. */
const NUDGE = 1e-4;
/** The grid of placement positions after the tidy pass (mm, T306). */
const GRID_MM = 1e-3;

class SheetState {
  readonly fps: Footprint[] = [];
  readonly cells = new Map<number, number[]>();
  readonly cw: number;
  readonly ch: number;
  freeArea: number;
  /** Part ids that did not fit here: the sheet only gets fuller, so they never will. */
  readonly failed = new Set<string>();
  constructor(
    readonly width: number,
    readonly height: number,
    margin: number,
  ) {
    this.cw = Math.max(1, width / GRID);
    this.ch = Math.max(1, height / GRID);
    this.freeArea = Math.max(0, width - 2 * margin) * Math.max(0, height - 2 * margin);
  }
  private range(minX: number, minY: number, maxX: number, maxY: number): number[] {
    const clamp = (v: number) => Math.min(GRID - 1, Math.max(0, Math.floor(v)));
    return [
      clamp(minX / this.cw),
      clamp(minY / this.ch),
      clamp(maxX / this.cw),
      clamp(maxY / this.ch),
    ];
  }
  add(fp: Footprint, area: number): void {
    const id = this.fps.length;
    this.fps.push(fp);
    this.freeArea -= area;
    const [x0, y0, x1, y1] = this.range(fp.outer.minX, fp.outer.minY, fp.outer.maxX, fp.outer.maxY);
    for (let i = x0 as number; i <= (x1 as number); i++)
      for (let j = y0 as number; j <= (y1 as number); j++) {
        const key = j * GRID + i;
        const list = this.cells.get(key);
        if (list) list.push(id);
        else this.cells.set(key, [id]);
      }
  }
  /**
   * T306: whether `fp` overlaps a placed footprint other than `self`. Checks every footprint (no
   * grid cells): a tidied footprint may have moved across a cell border.
   */
  hitsExcept(fp: Footprint, self: number): boolean {
    for (const [id, other] of this.fps.entries()) {
      if (id !== self && footprintsOverlap(other, fp)) return true;
    }
    return false;
  }
  /** Whether `fp` overlaps a placed footprint. */
  hits(fp: Footprint): boolean {
    const [x0, y0, x1, y1] = this.range(fp.outer.minX, fp.outer.minY, fp.outer.maxX, fp.outer.maxY);
    const seen = new Set<number>();
    for (let i = x0 as number; i <= (x1 as number); i++)
      for (let j = y0 as number; j <= (y1 as number); j++) {
        for (const id of this.cells.get(j * GRID + i) ?? []) {
          if (seen.has(id)) continue;
          seen.add(id);
          if (footprintsOverlap(this.fps[id] as Footprint, fp)) return true;
        }
      }
    return false;
  }
}

interface Spot {
  x: number;
  y: number;
  opt: number;
}

/** Differences below this (mm) are ties in the ranking (bisection and nudge noise). */
const RANK_TOL = 0.01;

const cmpTol = (a: number, b: number): number => (Math.abs(a - b) <= RANK_TOL ? 0 : a - b);

/** Ranking: lower top, then lower x (each within RANK_TOL), then the earlier rotation. */
function rank(item: ShapeItem, a: Spot, b: Spot): number {
  const ha = (item.options[a.opt] as ShapeOption).h;
  const hb = (item.options[b.opt] as ShapeOption).h;
  return cmpTol(a.y + ha, b.y + hb) || cmpTol(a.x, b.x) || a.opt - b.opt;
}

function uniqSorted(values: number[]): number[] {
  values.sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of values)
    if (out.length === 0 || v - (out[out.length - 1] as number) > 1e-9) out.push(v);
  return out;
}

/** Where `item` goes on `sheet` (bottom-left), or null. */
function findSpot(sheet: SheetState, item: ShapeItem, margin: number): Spot | null {
  const valid = (x: number, y: number, k: number): boolean => {
    const o = item.options[k] as ShapeOption;
    if (x < margin - EPS || y < margin - EPS) return false;
    if (x + o.w > sheet.width - margin + EPS || y + o.h > sheet.height - margin + EPS) return false;
    return !sheet.hits(moveFootprint(o.fp, x, y));
  };
  const found: Spot[] = [];
  let bestTop = Infinity;
  item.options.forEach((o, k) => {
    const xMax = sheet.width - margin - o.w + EPS;
    const yMax = sheet.height - margin - o.h + EPS;
    if (xMax < margin - EPS || yMax < margin - EPS) return;
    const xs = uniqSorted([
      margin,
      ...sheet.fps
        .flatMap((f) => [
          f.outer.maxX - o.fp.outer.minX + NUDGE,
          // Part-in-hole (T166): the left edge of every hole zone.
          ...f.holes.map((h) => h.minX - o.fp.outer.minX + NUDGE),
        ])
        .filter((x) => x > margin && x <= xMax),
    ]);
    for (const x of xs) {
      const lo = x + o.fp.outer.minX;
      const hi = x + o.fp.outer.maxX;
      const ys = uniqSorted([
        margin,
        ...sheet.fps
          .filter((f) => f.outer.minX < hi && f.outer.maxX > lo)
          .flatMap((f) => [
            f.outer.maxY - o.fp.outer.minY + NUDGE,
            ...f.holes
              .filter((h) => h.minX < hi && h.maxX > lo)
              .map((h) => h.minY - o.fp.outer.minY + NUDGE),
          ])
          .filter((y) => y > margin && y <= yMax),
      ]);
      for (const y of ys) {
        if (y + o.h > bestTop + 1e-9) break;
        if (!valid(x, y, k)) continue;
        found.push({ x, y, opt: k });
        bestTop = Math.min(bestTop, y + o.h);
        break;
      }
    }
  });
  if (found.length === 0) return null;
  found.sort((a, b) => rank(item, a, b));
  // Compaction: bisection between a known valid and a known invalid position, never leaving the
  // set of tested valid positions, so the result is always valid.
  const slide = (s: Spot, axis: 'x' | 'y'): Spot => {
    const at = (v: number): Spot => (axis === 'x' ? { ...s, x: v } : { ...s, y: v });
    let good = s[axis];
    if (good - margin <= 1e-9) return s;
    const floor = at(margin);
    if (valid(floor.x, floor.y, s.opt)) return floor;
    let bad = margin;
    for (let i = 0; i < SLIDE_STEPS && good - bad > 0.01; i++) {
      const mid = (good + bad) / 2;
      const m = at(mid);
      if (valid(m.x, m.y, s.opt)) good = mid;
      else bad = mid;
    }
    return at(good);
  };
  let best: Spot | null = null;
  // The best few overall plus the best spot of every rotation: a rotation that interlocks only
  // shows its value after compaction (a 180° triangle next to a 0° one).
  const pool: Spot[] = found.slice(0, COMPACT_TOP);
  const seenOpt = new Set(pool.map((p) => p.opt));
  for (const f of found) {
    if (seenOpt.has(f.opt)) continue;
    seenOpt.add(f.opt);
    pool.push(f);
  }
  for (const s of pool) {
    const c = slide(slide(slide(s, 'y'), 'x'), 'y');
    if (best === null || rank(item, c, best) < 0) best = c;
  }
  return best;
}

/**
 * Grid values to try for a placement position (T306): the nearest first, then the one on the
 * other side (a part nudged off a neighbour moves away from it when touching reads as an
 * overlap). Empty when the value is already on the grid.
 */
export function tidyCandidates(v: number): number[] {
  const steps = Math.round(v / GRID_MM);
  const g = steps * GRID_MM;
  const off = v - g;
  if (Math.abs(off) <= 1e-9) return [];
  const clean = (n: number) => Number((n * GRID_MM).toFixed(3));
  return [clean(steps), clean(off > 0 ? steps + 1 : steps - 1)];
}

/** Packs the items in the given order on true-shape footprints. Always terminates. */
export function packTrueShape(
  input: ShapePackInput,
  items: readonly ShapeItem[],
  /** T306: the grid tidy pass (on by default; off only to compare in tests). */
  opts: { tidy?: boolean } = {},
): ShapePacked {
  const { dims, margin } = input;
  const states: SheetState[] = [];
  const sheets: Placement[][] = [];
  const sizeOf: number[] = [];
  const used = dims.map(() => 0);
  const sizeIndex = (k: number): number =>
    Number.isInteger(k) && k >= 0 && k < dims.length ? k : 0;
  const openSheet = (k: number): SheetState => {
    const d = dims[k] as ShapeSheetSize;
    const st = new SheetState(d.width, d.height, margin);
    states.push(st);
    sheets.push([]);
    sizeOf.push(k);
    used[k] = (used[k] ?? 0) + 1;
    return st;
  };
  for (const l of input.locked) {
    const st = openSheet(sizeIndex(l.size));
    for (const fp of l.obstacles) st.add(fp, 0);
  }
  const fitsEmpty = (k: number, item: ShapeItem): boolean => {
    const d = dims[k] as ShapeSheetSize;
    return item.options.some(
      (o) => o.w <= d.width - 2 * margin + EPS && o.h <= d.height - 2 * margin + EPS,
    );
  };
  const suffixArea: number[] = new Array<number>(items.length + 1).fill(0);
  for (let i = items.length - 1; i >= 0; i--)
    suffixArea[i] = (suffixArea[i + 1] as number) + (items[i] as ShapeItem).area;

  const unplaced: UnplacedPart[] = [];
  /** Per sheet, per new placement: its footprint index on the sheet and its unmoved footprint. */
  const placedFps: { id: number; fp: Footprint; o: ShapeOption }[][] = sheets.map(() => []);
  const put = (si: number, item: ShapeItem, spot: Spot): void => {
    const o = item.options[spot.opt] as ShapeOption;
    const st = states[si] as SheetState;
    (placedFps[si] ??= []).push({ id: st.fps.length, fp: o.fp, o });
    st.add(moveFootprint(o.fp, spot.x, spot.y), item.area);
    (sheets[si] as Placement[]).push({
      partId: item.partId,
      index: item.index,
      x: spot.x,
      y: spot.y,
      rot: o.rot,
      locked: false,
    });
  };
  items.forEach((item, at) => {
    for (const [si, st] of states.entries()) {
      if (st.failed.has(item.partId) || st.freeArea < item.area - EPS) continue;
      const spot = findSpot(st, item, margin);
      if (spot) {
        put(si, item, spot);
        return;
      }
      st.failed.add(item.partId);
    }
    // New sheet: among sizes with stock left that take the item, the one whose area best matches
    // the remaining parts (least uncovered share); ties by list order.
    let pick = -1;
    let pickWaste = Infinity;
    // T168: an offcut that takes the item is used before any full sheet.
    const left = (k: number): boolean => {
      const d = dims[k];
      return d !== undefined && (d.qty === undefined || (used[k] ?? 0) < d.qty);
    };
    const offcutFirst = dims.some((d, k) => d.offcutId && left(k) && fitsEmpty(k, item));
    dims.forEach((d, k) => {
      if (!left(k)) return;
      if (offcutFirst && !d.offcutId) return;
      if (!fitsEmpty(k, item)) return;
      const usable = Math.max(0, d.width - 2 * margin) * Math.max(0, d.height - 2 * margin);
      const waste = 1 - Math.min(suffixArea[at] as number, usable) / (d.width * d.height);
      if (waste < pickWaste - 1e-12) {
        pickWaste = waste;
        pick = k;
      }
    });
    if (pick < 0) {
      const any = dims.some((_, k) => fitsEmpty(k, item));
      unplaced.push({
        partId: item.partId,
        index: item.index,
        reason: any ? 'NO_STOCK' : 'TOO_LARGE',
      });
      return;
    }
    const st = openSheet(pick);
    const spot = findSpot(st, item, margin);
    if (spot) put(states.length - 1, item, spot);
    else {
      states.pop();
      sheets.pop();
      sizeOf.pop();
      placedFps.length = Math.min(placedFps.length, states.length);
      used[pick] = (used[pick] ?? 1) - 1;
      unplaced.push({ partId: item.partId, index: item.index, reason: 'TOO_LARGE' });
    }
  });
  // T306: tidy pass over the finished sheets, in placement order.
  for (const [si, st] of opts.tidy === false ? [] : states.entries()) {
    const list = sheets[si] as Placement[];
    for (const [k, p] of list.entries()) {
      const meta = placedFps[si]?.[k];
      if (!meta) continue;
      const inside = (x: number, y: number): boolean =>
        x >= margin - EPS &&
        y >= margin - EPS &&
        x + meta.o.w <= st.width - margin + EPS &&
        y + meta.o.h <= st.height - margin + EPS;
      for (const axis of ['x', 'y'] as const) {
        for (const v of tidyCandidates(p[axis])) {
          const x = axis === 'x' ? v : p.x;
          const y = axis === 'y' ? v : p.y;
          if (!inside(x, y)) continue;
          const moved = moveFootprint(meta.fp, x, y);
          if (st.hitsExcept(moved, meta.id)) continue;
          st.fps[meta.id] = moved;
          p[axis] = v;
          break;
        }
      }
    }
  }
  return { sheets, sizeOf, unplaced };
}
