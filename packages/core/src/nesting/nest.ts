/**
 * Rectangle placer, min-waste mode (spec §6.2, D-019). Tries every part ordering × heuristic,
 * packs part copies sheet by sheet, scores each candidate with the objective and returns the best.
 * Pure and deterministic: no randomness, stable sorts with id/index tie-breakers, first candidate
 * wins ties, so the same input gives a byte-identical result.
 */
import { allowedRotations, rotationPolicyOf } from '../geometry/grain';
import { contour, signedArea } from '../geometry/polyline';
import { isQuarterTurn } from '../geometry/transform';
import {
  defaultSheet,
  deriveOutline,
  sheetSizeOf,
  stockSheetSizes,
  type Placement,
  type Project,
} from '../schema';
import { cutOrder, type OrderItem } from '../toolpath/order';
import { loopSegments, pathLength } from '../toolpath/path';
import {
  footprintContours,
  moveFootprint,
  rectOutline,
  shapeOption,
  type ShapeOption,
} from './shape';
import { packTrueShape, type ShapeItem, type ShapePackInput } from './trueshape';
import type { Polyline } from '../geometry/types';
import { compareScore, GuillotineBin, MaxRectsBin, type Bin, type Fit } from './bins';
import {
  fitsUsableAny,
  partBoxSize,
  partShape,
  rotatedBoxSize,
  rotationOptions,
  usableSize,
  type PartShape,
  type RotationOption,
} from './fit';
import {
  MODE_WEIGHTS,
  type NestingInfo,
  type NestingInput,
  type NestingResult,
  type NestPart,
  type ObjectiveCost,
  type NestingEngine,
  type ObjectiveWeights,
  type PartOrdering,
  type PlacerHeuristic,
  type Rect,
  type SheetStats,
  type UnplacedPart,
} from './types';
import { toCutSizes } from '../schema/cut-size';
import type { OffcutSheet } from './offcuts';

/** Orderings tried, in this order (earlier wins ties). */
export const PART_ORDERINGS: readonly PartOrdering[] = [
  'area',
  'longestSide',
  'perimeter',
  'height',
  'width',
];

/** Heuristics tried, in this order (earlier wins ties). */
export const PLACER_HEURISTICS: readonly PlacerHeuristic[] = [
  'maxrects-bssf',
  'maxrects-baf',
  'maxrects-bl',
  'guillotine-bssf',
  'guillotine-baf',
];

/**
 * Half the required distance between two parts: every part is inflated by this on each side for
 * collision checks, so two parts end up at least `toolDiameter + gap` apart (D-019).
 */
export function partSpacing(toolDiameter: number, gap: number): number {
  return (toolDiameter + gap) / 2;
}

/**
 * Footprint of a placement on its sheet (not inflated): the axis-aligned bbox of the rotated
 * outline (D-034; for quarter turns the swapped w × h); null when the part is unknown.
 */
export function placementRect(
  placement: Placement,
  parts: ReadonlyMap<string, PartShape>,
): Rect | null {
  const part = parts.get(placement.partId);
  if (!part) return null;
  return { x: placement.x, y: placement.y, ...rotatedBoxSize(part, placement.rot) };
}

interface Item {
  partId: string;
  index: number;
  /** Tool set key (sorted tool numbers) and its size, for the `toolGroup` ordering. */
  group: string;
  groupSize: number;
  /** Footprint of the first option (orderings use it). */
  w: number;
  h: number;
  /** Distinct footprints over the allowed rotations (D-034). */
  options: readonly RotationOption[];
}

const QUARTER_TURNS = [0, 90, 180, 270] as const;

/** The rotations a placer part may take: `rotations`, else the grainLock short form. */
export function nestPartRotations(part: NestPart): readonly number[] {
  return part.rotations ?? (part.grainLock ? [0, 180] : QUARTER_TURNS);
}

function orderKey(item: Item, ordering: PartOrdering): number {
  switch (ordering) {
    case 'area':
    case 'toolGroup':
      return item.w * item.h;
    case 'longestSide':
      return Math.max(item.w, item.h);
    case 'perimeter':
      return item.w + item.h;
    case 'height':
      return item.h;
    case 'width':
      return item.w;
  }
}

/** Descending by the ordering key; ties by part id (code-unit order), then copy index. */
function ordered(items: readonly Item[], ordering: PartOrdering): Item[] {
  return items
    .map((item) => ({ item, key: orderKey(item, ordering) }))
    .sort(
      (a, b) =>
        (ordering === 'toolGroup'
          ? a.item.groupSize - b.item.groupSize ||
            (a.item.group < b.item.group ? -1 : a.item.group > b.item.group ? 1 : 0)
          : 0) ||
        b.key - a.key ||
        (a.item.partId < b.item.partId ? -1 : a.item.partId > b.item.partId ? 1 : 0) ||
        a.item.index - b.item.index,
    )
    .map((e) => e.item);
}

function makeBin(heuristic: PlacerHeuristic, area: Rect): Bin {
  switch (heuristic) {
    case 'maxrects-bssf':
      return new MaxRectsBin(area, 'bssf');
    case 'maxrects-baf':
      return new MaxRectsBin(area, 'baf');
    case 'maxrects-bl':
      return new MaxRectsBin(area, 'bl');
    case 'guillotine-bssf':
      return new GuillotineBin(area, 'bssf');
    case 'guillotine-baf':
    case 'trueshape-bl': // never packed here (true-shape has its own placer)
      return new GuillotineBin(area, 'baf');
  }
}

interface Context {
  input: NestingInput;
  sizes: ReadonlyMap<string, { w: number; h: number }>;
  /** Inflation per side. */
  s: number;
  /** The bin area: usable area grown by `s` (so an inflated part inside it = part inside usable). */
  area: Rect;
  /** Stock sheet sizes (T164); one entry = the single-size path. */
  dims: readonly SheetDim[];
  /** Bin area per size (`areas[0]` = `area`). */
  areas: readonly Rect[];
  /** Tools one copy of each part needs, sorted (the contour tool included, T162). */
  tools: ReadonlyMap<string, readonly number[]>;
  /** Outer contour length of each part, mm. */
  perimeters: ReadonlyMap<string, number>;
  contourTool: number;
}

interface Packed {
  /** New placements per sheet (locked ones are not included). */
  sheets: Placement[][];
  /** Size index (into `ctx.dims`) of each sheet (T164). */
  sizeOf: number[];
  unplaced: UnplacedPart[];
}

interface SheetDim {
  width: number;
  height: number;
  qty?: number | undefined;
  offcutId?: string | undefined;
}

function inflate(r: Rect, s: number): Rect {
  return { x: r.x - s, y: r.y - s, w: r.w + 2 * s, h: r.h + 2 * s };
}

/**
 * How a new sheet's size is chosen when the stock lists several sizes (T312). `greedy`: the size
 * whose greedy fill of the remaining items wastes the smallest share (T164). `fitAll`: the smallest
 * size that takes every remaining item, else greedy (one big sheet can beat two small ones).
 * `prefer`: stock size `k` whenever it takes the item, else greedy. One size: nothing to choose.
 */
export type SizePolicy = { kind: 'greedy' } | { kind: 'fitAll' } | { kind: 'prefer'; k: number };

const GREEDY: SizePolicy = { kind: 'greedy' };

/** Size policies tried for a job (T312): greedy first (it wins ties), then the alternatives. */
export function sizePolicies(dims: readonly { offcutId?: string | undefined }[]): SizePolicy[] {
  if (dims.length <= 1) return [GREEDY];
  const out: SizePolicy[] = [GREEDY, { kind: 'fitAll' }];
  dims.forEach((d, k) => {
    if (!d.offcutId) out.push({ kind: 'prefer', k });
  });
  return out;
}

/**
 * Packs the items in the given order with one heuristic. Always terminates: one pass per item.
 * Open sheets come first (T312): every open sheet and every allowed rotation is tried before a new
 * sheet is opened. A guillotine bin keeps only part of its free space, so with several stock sizes
 * an exact MaxRects shadow of each sheet is asked too before a new sheet is opened. One stock size
 * keeps the old path byte for byte (PO, B56 round 1).
 */
function pack(
  ctx: Context,
  items: readonly Item[],
  heuristic: PlacerHeuristic,
  policy: SizePolicy = GREEDY,
): Packed {
  const { input, s } = ctx;
  const bins: Bin[] = [];
  const exact = ctx.dims.length > 1 && heuristic.startsWith('guillotine');
  const shadows: MaxRectsBin[] = [];
  const sheets: Placement[][] = [];
  const sizeOf: number[] = [];
  const used = ctx.dims.map(() => 0);
  const openSheet = (k: number): Bin => {
    const bin = makeBin(heuristic, ctx.areas[k] ?? ctx.area);
    bins.push(bin);
    if (exact) shadows.push(new MaxRectsBin(ctx.areas[k] ?? ctx.area, 'bl'));
    sheets.push([]);
    sizeOf.push(k);
    used[k] = (used[k] ?? 0) + 1;
    return bin;
  };
  const sizeIndex = (k: number | undefined): number =>
    k !== undefined && Number.isInteger(k) && k >= 0 && k < ctx.dims.length ? k : 0;
  for (const [li, locked] of input.locked.entries()) {
    const bin = openSheet(sizeIndex(input.lockedSizes?.[li]));
    for (const pl of locked) {
      const r = placementRect(pl, ctx.sizes);
      if (r) {
        bin.occupy(inflate(r, s));
        shadows[shadows.length - 1]?.occupy(inflate(r, s));
      }
    }
  }

  const unplaced: UnplacedPart[] = [];
  const tryBin = (bin: Bin, item: Item): { fit: Fit; opt: RotationOption } | null => {
    let best: { fit: Fit; opt: RotationOption } | null = null;
    for (const opt of item.options) {
      const fit = bin.find(opt.w + 2 * s, opt.h + 2 * s);
      if (fit && (best === null || compareScore(fit.score, best.fit.score) < 0)) {
        best = { fit, opt };
      }
    }
    return best;
  };
  const place = (sheet: number, item: Item, fit: Fit, opt: RotationOption): void => {
    const { rot } = opt;
    const taken = { x: fit.x, y: fit.y, w: opt.w + 2 * s, h: opt.h + 2 * s };
    bins[sheet]?.occupy(taken);
    shadows[sheet]?.occupy(taken);
    sheets[sheet]?.push({
      partId: item.partId,
      index: item.index,
      x: fit.x + s,
      y: fit.y + s,
      rot,
      locked: false,
    });
  };

  /**
   * Size of the next new sheet for `items[from]` (T164): among the sizes with stock left that
   * take the item, the one whose greedy fill of the remaining items wastes the smallest share of
   * the sheet; ties by list order. A single size skips the trial (the old path).
   */
  const pickSize = (from: number): number | null => {
    const item = items[from];
    if (!item) return null;
    const open: number[] = [];
    ctx.dims.forEach((d, k) => {
      if (d.qty !== undefined && (used[k] ?? 0) >= d.qty) return;
      if (ctx.dims.length === 1 || tryBin(makeBin(heuristic, ctx.areas[k] ?? ctx.area), item)) {
        open.push(k);
      }
    });
    // T168: an offcut that takes the item is used before any full sheet.
    const pool = open.some((k) => ctx.dims[k]?.offcutId)
      ? open.filter((k) => ctx.dims[k]?.offcutId)
      : open;
    if (pool.length <= 1) return pool[0] ?? null;
    if (policy.kind === 'prefer' && pool.includes(policy.k)) return policy.k;
    let best: number | null = null;
    let bestWaste = Infinity;
    let all: number | null = null;
    let allArea = Infinity;
    for (const k of pool) {
      const d = ctx.dims[k] as SheetDim;
      const trial = makeBin(heuristic, ctx.areas[k] ?? ctx.area);
      let partArea = 0;
      let missed = 0;
      for (let j = from; j < items.length; j++) {
        const it = items[j] as Item;
        const hit = tryBin(trial, it);
        if (!hit) {
          missed++;
          continue;
        }
        trial.occupy({ x: hit.fit.x, y: hit.fit.y, w: hit.opt.w + 2 * s, h: hit.opt.h + 2 * s });
        partArea += hit.opt.w * hit.opt.h;
      }
      const area = d.width * d.height;
      const waste = 1 - partArea / area;
      if (waste < bestWaste - 1e-12) {
        bestWaste = waste;
        best = k;
      }
      if (missed === 0 && area < allArea - 1e-9) {
        allArea = area;
        all = k;
      }
    }
    return policy.kind === 'fitAll' && all !== null ? all : best;
  };

  for (const [at, item] of items.entries()) {
    let done = false;
    for (const [i, bin] of bins.entries()) {
      // T312: a guillotine bin may have lost room its sheet still has: ask the exact shadow of
      // the same sheet before moving on, so an earlier sheet is always filled first.
      const shadow = shadows[i];
      const hit = tryBin(bin, item) ?? (shadow ? tryBin(shadow, item) : null);
      if (hit) {
        place(i, item, hit.fit, hit.opt);
        done = true;
        break;
      }
    }
    if (done) continue;
    const k = pickSize(at);
    if (k === null) {
      unplaced.push({ partId: item.partId, index: item.index, reason: 'NO_STOCK' });
      continue;
    }
    const bin = openSheet(k);
    const hit = tryBin(bin, item);
    if (hit) {
      place(bins.length - 1, item, hit.fit, hit.opt);
    } else {
      // Defensive (items too large are filtered before packing): never leave an empty sheet.
      bins.pop();
      if (exact) shadows.pop();
      sheets.pop();
      sizeOf.pop();
      used[k] = (used[k] ?? 1) - 1;
      unplaced.push({ partId: item.partId, index: item.index, reason: 'TOO_LARGE' });
    }
  }
  return { sheets, sizeOf, unplaced };
}

/** A part's own outline area, mm² (the w × h rectangle without an outline). */
export function outlineArea(shape: PartShape): number {
  return shape.outline ? Math.abs(signedArea(shape.outline)) : shape.w * shape.h;
}

/** Statistics of one sheet's placements (bounding-box areas, raw sheet area). */
export function sheetStats(
  index: number,
  placements: readonly Placement[],
  sheet: { width: number; height: number },
  sizes: ReadonlyMap<string, PartShape>,
  /** True-shape layouts (T165) count each part's own outline area, not its bbox. */
  trueArea = false,
): SheetStats {
  let partArea = 0;
  for (const pl of placements) {
    const shape = sizes.get(pl.partId);
    if (trueArea && shape) {
      partArea += outlineArea(shape);
      continue;
    }
    const r = placementRect(pl, sizes);
    if (r) partArea += r.w * r.h;
  }
  const sheetArea = sheet.width * sheet.height;
  const wasteArea = sheetArea - partArea;
  return {
    index,
    placed: placements.length,
    partArea,
    sheetArea,
    wasteArea,
    wastePercent: sheetArea > 0 ? (100 * wasteArea) / sheetArea : 0,
  };
}

/**
 * A_waste (D-019): every sheet but the last counts in full; the last sheet counts only the strip
 * the parts use (the smaller of the full-height strip up to the rightmost part and the full-width
 * strip up to the topmost part, kerf included), because the rest stays a reusable offcut.
 */
function wasteArea(
  ctx: Context,
  sheets: readonly (readonly Placement[])[],
  stats: readonly SheetStats[],
  dims: readonly SheetDim[],
): number {
  let waste = 0;
  sheets.forEach((placements, i) => {
    const st = stats[i];
    if (!st) return;
    if (i < sheets.length - 1) {
      waste += st.wasteArea;
      return;
    }
    const { width, height } = dims[i] ?? ctx.input.sheet;
    let right = 0;
    let top = 0;
    for (const pl of placements) {
      const r = placementRect(pl, ctx.sizes);
      if (!r) continue;
      right = Math.max(right, r.x + r.w + ctx.s);
      top = Math.max(top, r.y + r.h + ctx.s);
    }
    const used = Math.min(Math.min(right, width) * height, width * Math.min(top, height));
    waste += Math.max(0, used - st.partArea);
  });
  return waste;
}

/**
 * Estimated XY path of a layout, mm (T162, "from the toolpath model"): the outer contour lengths
 * plus the travel between copies in the order `cutOrder` gives (holes per tool, then the outer
 * contour; small parts first; tools grouped; from the sheet origin; no 2-opt). Every copy is
 * entered at its footprint centre: an estimate, the toolpath computes the real path.
 */
function pathEstimate(ctx: Context, layout: readonly (readonly Placement[])[]): number {
  let length = 0;
  const items: OrderItem[] = [];
  layout.forEach((placements, sheet) => {
    for (const pl of placements) {
      const r = placementRect(pl, ctx.sizes);
      if (!r) continue;
      length += ctx.perimeters.get(pl.partId) ?? 2 * (r.w + r.h);
      const centre = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      const part = `${pl.partId}#${pl.index}`;
      for (const tool of ctx.tools.get(pl.partId) ?? []) {
        if (tool === ctx.contourTool) continue;
        items.push({ sheet, part, cls: 'drill', tool, area: 0, starts: [centre] });
      }
      items.push({
        sheet,
        part,
        cls: 'outer',
        tool: ctx.contourTool,
        area: r.w * r.h,
        starts: [centre],
      });
    }
  });
  if (items.length > 0) {
    length += cutOrder(items, { mode: ctx.input.mode, maxEvaluations: 0 }).rapid;
  }
  return length;
}

/** Tool changes of a layout: per sheet, the distinct tools of its copies minus one. */
function toolChangeCount(ctx: Context, layout: readonly (readonly Placement[])[]): number {
  let n = 0;
  for (const placements of layout) {
    const tools = new Set<number>();
    for (const pl of placements) for (const t of ctx.tools.get(pl.partId) ?? []) tools.add(t);
    if (tools.size > 1) n += tools.size - 1;
  }
  return n;
}

/**
 * The objective (spec §6.2): `waste·A + λ·L + μ·N + ν·C`. A term whose weight is 0 adds nothing;
 * with `all` false it is not even measured (min-waste stays as fast as before T162).
 */
function objective(
  ctx: Context,
  layout: readonly (readonly Placement[])[],
  stats: readonly SheetStats[],
  dims: readonly SheetDim[],
  weights: ObjectiveWeights,
  all: boolean,
): ObjectiveCost {
  const waste = wasteArea(ctx, layout, stats, dims);
  const cut = all || weights.cutLength !== 0 ? pathEstimate(ctx, layout) : 0;
  const changes = all || weights.toolChanges !== 0 ? toolChangeCount(ctx, layout) : 0;
  const handling = layout.length;
  let total = weights.waste * waste;
  if (weights.cutLength !== 0) total += weights.cutLength * cut;
  if (weights.toolChanges !== 0) total += weights.toolChanges * changes;
  if (weights.handling !== 0) total += weights.handling * handling;
  return { wasteArea: waste, cutLength: cut, toolChanges: changes, handling, total };
}

function weightsOf(input: NestingInput): ObjectiveWeights {
  return { ...MODE_WEIGHTS[input.mode], ...stripUndefined(input.weights ?? {}) };
}

function stripUndefined(w: Partial<ObjectiveWeights>): Partial<ObjectiveWeights> {
  const out: Partial<ObjectiveWeights> = {};
  for (const key of ['waste', 'cutLength', 'toolChanges', 'handling'] as const) {
    const v = w[key];
    if (v !== undefined) out[key] = v;
  }
  return out;
}

export interface Candidate {
  ordering: PartOrdering;
  heuristic: PlacerHeuristic;
  layout: Placement[][];
  /** Size of each sheet (T164). */
  dims: SheetDim[];
  unplaced: UnplacedPart[];
  stats: SheetStats[];
  cost: ObjectiveCost;
}

/** Total area of a candidate's sheets, mm². */
const sheetArea = (c: Candidate) => c.dims.reduce((s, d) => s + d.width * d.height, 0);

/**
 * Total sheet areas closer than this share count as equal (D-103): then fewer sheets win, since
 * handling 13 more sheets for 0.7 % less board is a bad trade.
 */
export const SHEET_AREA_TOLERANCE = 0.02;

/**
 * Candidate ranking: fewer unplaced copies, then fewer sheets, then the objective. With several
 * stock sizes (`mixed`, D-056, D-103) the total sheet area decides when it differs by
 * `SHEET_AREA_TOLERANCE` or more (two small sheets can beat one big one); within it fewer sheets
 * win, then less area, then the objective. One size: the count is compared as before, so
 * single-size results stay byte-identical.
 */
export function better(a: Candidate, b: Candidate, mixed: boolean): boolean {
  const unplaced = a.unplaced.length - b.unplaced.length;
  if (unplaced !== 0) return unplaced < 0;
  if (!mixed) {
    return (a.layout.length - b.layout.length || a.cost.total - b.cost.total) < 0;
  }
  const areaA = sheetArea(a);
  const areaB = sheetArea(b);
  const close = Math.abs(areaA - areaB) < SHEET_AREA_TOLERANCE * Math.min(areaA, areaB);
  if (!close) return areaA < areaB;
  return (a.layout.length - b.layout.length || areaA - areaB || a.cost.total - b.cost.total) < 0;
}

/** Optional callbacks of a placer run (T163). They never change the result. */
export interface NestHooks {
  /**
   * Called after every ordering × heuristic candidate with the number done and the total, so a
   * worker can report progress. Deterministic: the same calls for the same input.
   */
  onProgress?: ((done: number, total: number) => void) | undefined;
}

/** Runs the placer. Locked placements are copied unchanged and act as obstacles on their sheet. */
export function nest(input: NestingInput, hooks: NestHooks = {}): NestingResult {
  const sizes = new Map<string, PartShape>();
  for (const p of input.parts) {
    if (!sizes.has(p.id)) sizes.set(p.id, { w: p.w, h: p.h, outline: p.outline });
  }
  const s = partSpacing(input.toolDiameter, input.gap);
  const dims: readonly SheetDim[] =
    input.sheets && input.sheets.length > 0 ? input.sheets : [input.sheet];
  const usables = dims.map((d) => usableSize(d, input.margin));
  const usable = usables[0] ?? usableSize(input.sheet, input.margin);
  // Tool numbers are positive; -1 stands for an unknown contour tool distinct from every hole tool.
  const contourTool = input.contourTool ?? -1;
  const tools = new Map<string, readonly number[]>();
  const perimeters = new Map<string, number>();
  for (const p of input.parts) {
    if (tools.has(p.id)) continue;
    tools.set(
      p.id,
      [...new Set([contourTool, ...(p.holeTools ?? [])])].sort((a, b) => a - b),
    );
    perimeters.set(p.id, p.outline ? pathLength(loopSegments(p.outline)) : 2 * (p.w + p.h));
  }
  const ctx: Context = {
    tools,
    perimeters,
    contourTool,
    input,
    sizes,
    s,
    area: {
      x: input.margin - s,
      y: input.margin - s,
      w: usable.width + 2 * s,
      h: usable.height + 2 * s,
    },
    dims,
    areas: usables.map((u) => ({
      x: input.margin - s,
      y: input.margin - s,
      w: u.width + 2 * s,
      h: u.height + 2 * s,
    })),
  };

  const lockedKeys = new Set<string>();
  for (const sheet of input.locked)
    for (const pl of sheet) lockedKeys.add(`${pl.partId}#${pl.index}`);

  const items: Item[] = [];
  const tooLarge: UnplacedPart[] = [];
  const seen = new Set<string>();
  input.parts.forEach((part: NestPart) => {
    if (seen.has(part.id)) return;
    seen.add(part.id);
    const options = rotationOptions(
      sizes.get(part.id) ?? { w: part.w, h: part.h },
      nestPartRotations(part),
    );
    for (let index = 0; index < part.qty; index++) {
      if (lockedKeys.has(`${part.id}#${index}`)) continue;
      if (!usables.some((u) => fitsUsableAny(options, u))) {
        tooLarge.push({ partId: part.id, index, reason: 'TOO_LARGE' });
        continue;
      }
      const first = options[0] as RotationOption;
      const set = tools.get(part.id) ?? [];
      items.push({
        partId: part.id,
        index,
        w: first.w,
        h: first.h,
        options,
        group: set.join(','),
        groupSize: set.length,
      });
    }
  });

  const weights = weightsOf(input);
  let best: Candidate | null = null;
  let count = 0;
  const trueShape = input.engine === 'trueShape';
  // `toolGroup` only differs from `area` when the copies need different tool sets (T162).
  const groups = new Set(items.map((it) => it.group));
  const orderings: readonly PartOrdering[] = trueShape
    ? TRUE_SHAPE_ORDERINGS
    : groups.size > 1
      ? [...PART_ORDERINGS, 'toolGroup']
      : PART_ORDERINGS;
  const heuristics: readonly PlacerHeuristic[] = trueShape ? ['trueshape-bl'] : PLACER_HEURISTICS;
  const shapes = trueShape ? trueShapeSetup(ctx) : null;
  // T312: with several stock sizes each ordering × heuristic also runs every size policy.
  const policies = trueShape ? [GREEDY] : sizePolicies(dims);
  const total = orderings.length * heuristics.length * policies.length;
  for (const ordering of orderings) {
    const list = ordered(items, ordering);
    for (const heuristic of heuristics)
      for (const policy of policies) {
        count++;
        if (count > 1) hooks.onProgress?.(count - 1, total);
        const packed = shapes
          ? packTrueShape(
              shapes.input,
              list.map((it) => shapes.item(it)),
            )
          : pack(ctx, list, heuristic, policy);
        const layout = packed.sheets.map((added, i) => [
          ...(input.locked[i] ?? []).map((pl) => ({ ...pl })),
          ...added,
        ]);
        const sheetDims = layout.map((_, i) => dims[packed.sizeOf[i] ?? 0] ?? input.sheet);
        const stats = layout.map((pls, i) =>
          sheetStats(i, pls, sheetDims[i] ?? input.sheet, sizes, trueShape),
        );
        const cost = objective(ctx, layout, stats, sheetDims, weights, false);
        const cand: Candidate = {
          ordering,
          heuristic,
          layout,
          dims: sheetDims,
          unplaced: [...tooLarge, ...packed.unplaced],
          stats,
          cost,
        };
        if (best === null || better(cand, best, dims.length > 1)) best = cand;
      }
  }
  hooks.onProgress?.(count, total);
  // At least one ordering × heuristic always runs, so `best` is set.
  if (best === null) throw new Error('nest: no candidate was tried');
  const win: Candidate = best;
  const partArea = win.stats.reduce((sum, st) => sum + st.partArea, 0);
  const sheetArea = win.stats.reduce((sum, st) => sum + st.sheetArea, 0);
  const wastePercent = sheetArea > 0 ? (100 * (sheetArea - partArea)) / sheetArea : 0;
  const unplaced = [...win.unplaced].sort(
    (a, b) => (a.partId < b.partId ? -1 : a.partId > b.partId ? 1 : 0) || a.index - b.index,
  );
  return {
    // A size per sheet only with several stock sizes (T164): single-size layouts stay identical.
    layout: {
      sheets: win.layout.map((placements, i) => {
        const d = win.dims[i];
        if (!(dims.length > 1 && d)) return { placements };
        const size = { width: d.width, height: d.height };
        return d.offcutId ? { size, offcutId: d.offcutId, placements } : { size, placements };
      }),
    },
    sheetCount: win.layout.length,
    sheets: win.stats,
    partArea,
    sheetArea,
    wastePercent,
    utilisationPercent: sheetArea > 0 ? 100 - wastePercent : 0,
    unplaced,
    // Every term measured for the report; the total (and so the choice) is unchanged.
    cost: objective(ctx, win.layout, win.stats, win.dims, weights, true),
    strategy: { ordering: win.ordering, heuristic: win.heuristic },
    candidates: count,
    // True-shape footprints are the real shapes: no rotated-bbox notes (D-034 stage 2).
    info: trueShape ? [] : rotatedBboxInfo(win.layout, sizes),
  };
}

/** Orderings the true-shape placer tries (each is one full placement run, T165). */
export const TRUE_SHAPE_ORDERINGS: readonly PartOrdering[] = ['area', 'longestSide', 'height'];

/**
 * Footprints per part and rotation, and the locked obstacles, for the true-shape placer (T165).
 * Footprint offset s = (toolDiameter + gap) / 2, the same spacing as the rectangle placer.
 */
function trueShapeSetup(ctx: Context): {
  input: ShapePackInput;
  item: (it: Item) => ShapeItem;
} {
  const { input, s, sizes } = ctx;
  const parts = new Map<string, NestPart>();
  for (const p of input.parts) if (!parts.has(p.id)) parts.set(p.id, p);
  const contours = new Map<
    string,
    { outline: Polyline; fc: ReturnType<typeof footprintContours> }
  >();
  const contourOf = (part: NestPart) => {
    let c = contours.get(part.id);
    if (!c) {
      const outline = part.outline ?? rectOutline(part.w, part.h);
      const inners = input.partInHole ? (part.inners ?? []) : [];
      c = { outline, fc: footprintContours(outline, inners, s) };
      contours.set(part.id, c);
    }
    return c;
  };
  // With part-in-hole the cutouts are free area (the placer's free-area pre-check, T166).
  const holeArea = new Map<string, number>();
  if (input.partInHole) {
    for (const part of parts.values()) {
      const a = (part.inners ?? []).reduce((sum, c) => sum + Math.abs(signedArea(c)), 0);
      if (a > 0) holeArea.set(part.id, a);
    }
  }
  const options = new Map<string, ShapeOption[]>();
  for (const part of parts.values()) {
    const c = contourOf(part);
    options.set(
      part.id,
      nestPartRotations(part).map((rot) => shapeOption(c.outline, c.fc, rot)),
    );
  }
  const locked = input.locked.map((pls, i) => ({
    size: input.lockedSizes?.[i] ?? 0,
    obstacles: pls.flatMap((pl) => {
      const part = parts.get(pl.partId);
      if (!part) return [];
      const c = contourOf(part);
      return [moveFootprint(shapeOption(c.outline, c.fc, pl.rot).fp, pl.x, pl.y)];
    }),
  }));
  const dimsOf = input.sheets && input.sheets.length > 0 ? input.sheets : [input.sheet];
  return {
    input: { dims: dimsOf, margin: input.margin, locked },
    item: (it) => {
      const shape = sizes.get(it.partId);
      return {
        partId: it.partId,
        index: it.index,
        options: options.get(it.partId) ?? [],
        area: (shape ? outlineArea(shape) : it.w * it.h) - (holeArea.get(it.partId) ?? 0),
      };
    },
  };
}

/** GRAIN_ROTATED_BBOX notes for every placement at a non-axis angle (D-034). */
function rotatedBboxInfo(
  layout: readonly (readonly Placement[])[],
  sizes: ReadonlyMap<string, PartShape>,
): NestingInfo[] {
  const info: NestingInfo[] = [];
  layout.forEach((placements, sheet) => {
    for (const pl of placements) {
      if (isQuarterTurn(pl.rot)) continue;
      const shape = sizes.get(pl.partId);
      if (!shape) continue;
      const box = rotatedBoxSize(shape, pl.rot);
      const own = shape.outline ? Math.abs(signedArea(shape.outline)) : shape.w * shape.h;
      info.push({
        code: 'GRAIN_ROTATED_BBOX',
        partId: pl.partId,
        index: pl.index,
        sheet,
        rot: pl.rot,
        extraArea: box.w * box.h - own,
      });
    }
  });
  return info;
}

/** Options the caller adds to the project data. */
export interface NestProjectOptions {
  /** Cutting tool diameter in mm, from the selected machine profile. */
  toolDiameter: number;
  /** Tool number of the outer contours (the material set's tool); absent = unknown (T162). */
  contourTool?: number | undefined;
  weights?: Partial<ObjectiveWeights> | undefined;
  /** Forces a placer engine; absent = `nestingEngineOf(project)` (T167). */
  engine?: NestingEngine | undefined;
  /**
   * Offcuts of the stock material and thickness (T168), already matched to the sheet grain
   * (`usableOffcuts`). Used only when `stock.useOffcuts`; tried before the stock sheets.
   */
  offcuts?: readonly OffcutSheet[] | undefined;
}

/**
 * Placer input from a project: rect parts by `params`, freeform parts by the arc-aware bounding
 * box of their outline (true-shape nesting is a later version, spec §6.2); locked placements per
 * sheet, trailing sheets without a locked placement dropped.
 */
export function nestingInputFromProject(
  entered: Project,
  options: NestProjectOptions,
): NestingInput {
  // T169: geometry is read at cut size (edge-band deduction, spec §4.8).
  const project = toCutSizes(entered);
  const locked = project.layout.sheets.map((sheet) => sheet.placements.filter((p) => p.locked));
  while (locked.length > 0 && locked[locked.length - 1]?.length === 0) locked.pop();
  // T164: several stock sizes only when the project lists them (absent = the single-size path).
  // T168: offcuts (qty 1 each) come first; without offcuts the paths above stay byte-identical.
  const offcuts = project.stock.useOffcuts ? (options.offcuts ?? []) : [];
  const stockSizes: SheetDim[] | null =
    project.stock.sheets || offcuts.length > 0
      ? [
          ...offcuts.map((o) => ({ width: o.width, height: o.height, qty: 1, offcutId: o.id })),
          ...stockSheetSizes(project),
        ]
      : null;
  const multi = stockSizes
    ? {
        sheets: stockSizes,
        lockedSizes: locked.map((_, i) => {
          const own = sheetSizeOf(project, i);
          const id = project.layout.sheets[i]?.offcutId;
          const byId = id ? stockSizes.findIndex((d) => d.offcutId === id) : -1;
          const k =
            byId >= 0
              ? byId
              : stockSizes.findIndex(
                  (d) => !d.offcutId && d.width === own.width && d.height === own.height,
                );
          return Math.max(0, k);
        }),
      }
    : {};
  return {
    ...multi,
    sheet: { width: defaultSheet(project).width, height: defaultSheet(project).height },
    parts: project.parts.map((part) => ({
      id: part.id,
      ...partBoxSize(part),
      qty: part.qty,
      // The grain rule (D-034): the single source of allowed rotations.
      rotations: allowedRotations(part, defaultSheet(project), rotationPolicyOf(project.nesting)),
      outline: contour(deriveOutline(part)),
      holeTools: part.holes.map((h) => h.tool),
      inners: part.inners.map((c) => contour(c)),
    })),
    gap: project.nesting.gap,
    margin: project.nesting.margin,
    toolDiameter: options.toolDiameter,
    mode: project.nesting.mode,
    locked,
    contourTool: options.contourTool,
    weights: options.weights,
    partInHole: project.nesting.partInHole === true,
    engine: options.engine ?? nestingEngineOf(project),
  };
}

/** Whether a closed outline is an axis-aligned rectangle (4 straight, axis-parallel edges). */
function isAxisRect(vertices: readonly { x: number; y: number; bulge: number }[]): boolean {
  if (vertices.length !== 4 || vertices.some((v) => v.bulge !== 0)) return false;
  return vertices.every((a, i) => {
    const b = vertices[(i + 1) % 4] as { x: number; y: number };
    return a.x === b.x || a.y === b.y;
  });
}

/**
 * Engine selection (T167, spec §6.2): rectangles at axis angles stay with MaxRects; a freeform
 * part (not an axis-aligned rectangle; a rounded-corner rect part counts as a rectangle), a part
 * with a non-axis allowed rotation (grain, step policy) or part-in-hole with an inner cutout
 * switches the whole job to true-shape (mixed jobs: true-shape for all).
 */
export function nestingEngineOf(project: Project): NestingEngine {
  const sheet = defaultSheet(project);
  const policy = rotationPolicyOf(project.nesting);
  for (const part of project.parts) {
    if (part.kind !== 'rect' && !isAxisRect(deriveOutline(part))) return 'trueShape';
    if (allowedRotations(part, sheet, policy).some((r) => !isQuarterTurn(r))) return 'trueShape';
    if (project.nesting.partInHole === true && part.inners.length > 0) return 'trueShape';
  }
  return 'maxrects';
}

/** Nests a project's parts. */
export function nestProject(
  project: Project,
  options: NestProjectOptions,
  hooks: NestHooks = {},
): NestingResult {
  return nest(nestingInputFromProject(project, options), hooks);
}

/** Summary of a stored layout (for the UI after `runNesting`). */
export interface LayoutSummary {
  sheetCount: number;
  sheets: SheetStats[];
  partArea: number;
  sheetArea: number;
  wastePercent: number;
  utilisationPercent: number;
  /** Part copies with no placement, by part id then copy index. */
  unplaced: { partId: string; index: number }[];
  /** The report per sheet size (T164), in the order sizes first appear in the layout. */
  bySize: SizeSummary[];
}

/** Sheets of one size in a layout (T164). */
export interface SizeSummary {
  width: number;
  height: number;
  /** Layout sheets of this size. */
  sheets: number;
  partArea: number;
  sheetArea: number;
  wastePercent: number;
}

/** Sheet count, waste % and unplaced copies of a project's current layout. Pure. */
export function summarizeLayout(entered: Project): LayoutSummary {
  // T169: geometry is read at cut size (edge-band deduction, spec §4.8).
  const project = toCutSizes(entered);
  const sizes = new Map(project.parts.map((p) => [p.id, partShape(p)]));
  const sheets = project.layout.sheets.map((sh, i) =>
    sheetStats(i, sh.placements, sheetSizeOf(project, i), sizes),
  );
  const placed = new Set<string>();
  for (const sh of project.layout.sheets) {
    for (const pl of sh.placements) placed.add(`${pl.partId}#${pl.index}`);
  }
  const unplaced: { partId: string; index: number }[] = [];
  for (const part of project.parts) {
    for (let index = 0; index < part.qty; index++) {
      if (!placed.has(`${part.id}#${index}`)) unplaced.push({ partId: part.id, index });
    }
  }
  unplaced.sort(
    (a, b) => (a.partId < b.partId ? -1 : a.partId > b.partId ? 1 : 0) || a.index - b.index,
  );
  const partArea = sheets.reduce((sum, st) => sum + st.partArea, 0);
  const sheetArea = sheets.reduce((sum, st) => sum + st.sheetArea, 0);
  const wastePercent = sheetArea > 0 ? (100 * (sheetArea - partArea)) / sheetArea : 0;
  const bySize = new Map<string, SizeSummary>();
  sheets.forEach((st, i) => {
    const { width, height } = sheetSizeOf(project, i);
    const key = `${width}x${height}`;
    const s = bySize.get(key) ?? {
      width,
      height,
      sheets: 0,
      partArea: 0,
      sheetArea: 0,
      wastePercent: 0,
    };
    s.sheets += 1;
    s.partArea += st.partArea;
    s.sheetArea += st.sheetArea;
    s.wastePercent = s.sheetArea > 0 ? (100 * (s.sheetArea - s.partArea)) / s.sheetArea : 0;
    bySize.set(key, s);
  });
  return {
    bySize: [...bySize.values()],
    sheetCount: sheets.length,
    sheets,
    partArea,
    sheetArea,
    wastePercent,
    utilisationPercent: sheetArea > 0 ? 100 - wastePercent : 0,
    unplaced,
  };
}
