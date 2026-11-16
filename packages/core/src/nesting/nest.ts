/**
 * Rectangle placer, min-waste mode (spec §6.2, D-019). Tries every part ordering × heuristic,
 * packs part copies sheet by sheet, scores each candidate with the objective and returns the best.
 * Pure and deterministic: no randomness, stable sorts with id/index tie-breakers, first candidate
 * wins ties, so the same input gives a byte-identical result.
 */
import type { Placement, Project } from '../schema';
import { compareScore, GuillotineBin, MaxRectsBin, type Bin, type Fit } from './bins';
import { fitsUsable, partBoxSize, usableSize } from './fit';
import {
  MODE_WEIGHTS,
  type NestingInput,
  type NestingResult,
  type NestPart,
  type ObjectiveCost,
  type ObjectiveWeights,
  type PartOrdering,
  type PlacerHeuristic,
  type Rect,
  type SheetStats,
  type UnplacedPart,
} from './types';

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

/** Size of a placed part's bounding box after rotation. */
function rotatedSize(w: number, h: number, rot: Placement['rot']): { w: number; h: number } {
  return rot === 90 || rot === 270 ? { w: h, h: w } : { w, h };
}

/** Footprint of a placement on its sheet (not inflated); null when the part is unknown. */
export function placementRect(
  placement: Placement,
  parts: ReadonlyMap<string, { w: number; h: number }>,
): Rect | null {
  const part = parts.get(placement.partId);
  if (!part) return null;
  const size = rotatedSize(part.w, part.h, placement.rot);
  return { x: placement.x, y: placement.y, ...size };
}

interface Item {
  partId: string;
  index: number;
  w: number;
  h: number;
  grainLock: boolean;
}

function orderKey(item: Item, ordering: PartOrdering): number {
  switch (ordering) {
    case 'area':
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
}

interface Packed {
  /** New placements per sheet (locked ones are not included). */
  sheets: Placement[][];
  unplaced: UnplacedPart[];
}

function inflate(r: Rect, s: number): Rect {
  return { x: r.x - s, y: r.y - s, w: r.w + 2 * s, h: r.h + 2 * s };
}

/** Packs the items in the given order with one heuristic. Always terminates: one pass per item. */
function pack(ctx: Context, items: readonly Item[], heuristic: PlacerHeuristic): Packed {
  const { input, s } = ctx;
  const bins: Bin[] = [];
  const sheets: Placement[][] = [];
  const openSheet = (): Bin => {
    const bin = makeBin(heuristic, ctx.area);
    bins.push(bin);
    sheets.push([]);
    return bin;
  };
  for (const locked of input.locked) {
    const bin = openSheet();
    for (const pl of locked) {
      const r = placementRect(pl, ctx.sizes);
      if (r) bin.occupy(inflate(r, s));
    }
  }

  const unplaced: UnplacedPart[] = [];
  const tryBin = (bin: Bin, item: Item): { fit: Fit; rot: 0 | 90 } | null => {
    let best: { fit: Fit; rot: 0 | 90 } | null = null;
    const rots: (0 | 90)[] = item.grainLock || item.w === item.h ? [0] : [0, 90];
    for (const rot of rots) {
      const size = rotatedSize(item.w, item.h, rot);
      const fit = bin.find(size.w + 2 * s, size.h + 2 * s);
      if (fit && (best === null || compareScore(fit.score, best.fit.score) < 0)) {
        best = { fit, rot };
      }
    }
    return best;
  };
  const place = (sheet: number, item: Item, fit: Fit, rot: 0 | 90): void => {
    const size = rotatedSize(item.w, item.h, rot);
    bins[sheet]?.occupy({ x: fit.x, y: fit.y, w: size.w + 2 * s, h: size.h + 2 * s });
    sheets[sheet]?.push({
      partId: item.partId,
      index: item.index,
      x: fit.x + s,
      y: fit.y + s,
      rot,
      locked: false,
    });
  };

  for (const item of items) {
    let done = false;
    for (const [i, bin] of bins.entries()) {
      const hit = tryBin(bin, item);
      if (hit) {
        place(i, item, hit.fit, hit.rot);
        done = true;
        break;
      }
    }
    if (done) continue;
    const bin = openSheet();
    const hit = tryBin(bin, item);
    if (hit) {
      place(bins.length - 1, item, hit.fit, hit.rot);
    } else {
      // Defensive (items too large are filtered before packing): never leave an empty sheet.
      bins.pop();
      sheets.pop();
      unplaced.push({ partId: item.partId, index: item.index, reason: 'TOO_LARGE' });
    }
  }
  return { sheets, unplaced };
}

/** Statistics of one sheet's placements (bounding-box areas, raw sheet area). */
export function sheetStats(
  index: number,
  placements: readonly Placement[],
  sheet: { width: number; height: number },
  sizes: ReadonlyMap<string, { w: number; h: number }>,
): SheetStats {
  let partArea = 0;
  for (const pl of placements) {
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
): number {
  const { width, height } = ctx.input.sheet;
  let waste = 0;
  sheets.forEach((placements, i) => {
    const st = stats[i];
    if (!st) return;
    if (i < sheets.length - 1) {
      waste += st.wasteArea;
      return;
    }
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

interface Candidate {
  ordering: PartOrdering;
  heuristic: PlacerHeuristic;
  layout: Placement[][];
  unplaced: UnplacedPart[];
  stats: SheetStats[];
  cost: ObjectiveCost;
}

function better(a: Candidate, b: Candidate): boolean {
  return (
    (a.unplaced.length - b.unplaced.length ||
      a.layout.length - b.layout.length ||
      a.cost.total - b.cost.total) < 0
  );
}

/** Runs the placer. Locked placements are copied unchanged and act as obstacles on their sheet. */
export function nest(input: NestingInput): NestingResult {
  const sizes = new Map<string, { w: number; h: number }>();
  for (const p of input.parts) if (!sizes.has(p.id)) sizes.set(p.id, { w: p.w, h: p.h });
  const s = partSpacing(input.toolDiameter, input.gap);
  const usable = usableSize(input.sheet, input.margin);
  const ctx: Context = {
    input,
    sizes,
    s,
    area: {
      x: input.margin - s,
      y: input.margin - s,
      w: usable.width + 2 * s,
      h: usable.height + 2 * s,
    },
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
    for (let index = 0; index < part.qty; index++) {
      if (lockedKeys.has(`${part.id}#${index}`)) continue;
      if (!fitsUsable(part.w, part.h, part.grainLock, usable)) {
        tooLarge.push({ partId: part.id, index, reason: 'TOO_LARGE' });
        continue;
      }
      items.push({ partId: part.id, index, w: part.w, h: part.h, grainLock: part.grainLock });
    }
  });

  const weights = weightsOf(input);
  let best: Candidate | null = null;
  let count = 0;
  for (const ordering of PART_ORDERINGS) {
    const list = ordered(items, ordering);
    for (const heuristic of PLACER_HEURISTICS) {
      count++;
      const packed = pack(ctx, list, heuristic);
      const layout = packed.sheets.map((added, i) => [
        ...(input.locked[i] ?? []).map((pl) => ({ ...pl })),
        ...added,
      ]);
      const stats = layout.map((pls, i) => sheetStats(i, pls, input.sheet, sizes));
      const waste = wasteArea(ctx, layout, stats);
      const cost: ObjectiveCost = {
        wasteArea: waste,
        cutLength: 0,
        toolChanges: 0,
        handling: 0,
        total: weights.waste * waste,
      };
      const cand: Candidate = {
        ordering,
        heuristic,
        layout,
        unplaced: [...tooLarge, ...packed.unplaced],
        stats,
        cost,
      };
      if (best === null || better(cand, best)) best = cand;
    }
  }
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
    layout: { sheets: win.layout.map((placements) => ({ placements })) },
    sheetCount: win.layout.length,
    sheets: win.stats,
    partArea,
    sheetArea,
    wastePercent,
    utilisationPercent: sheetArea > 0 ? 100 - wastePercent : 0,
    unplaced,
    cost: win.cost,
    strategy: { ordering: win.ordering, heuristic: win.heuristic },
    candidates: count,
  };
}

/** Options the caller adds to the project data. */
export interface NestProjectOptions {
  /** Cutting tool diameter in mm, from the selected machine profile. */
  toolDiameter: number;
  weights?: Partial<ObjectiveWeights> | undefined;
}

/**
 * Placer input from a project: rect parts by `params`, freeform parts by the arc-aware bounding
 * box of their outline (true-shape nesting is a later version, spec §6.2); locked placements per
 * sheet, trailing sheets without a locked placement dropped.
 */
export function nestingInputFromProject(
  project: Project,
  options: NestProjectOptions,
): NestingInput {
  const locked = project.layout.sheets.map((sheet) => sheet.placements.filter((p) => p.locked));
  while (locked.length > 0 && locked[locked.length - 1]?.length === 0) locked.pop();
  return {
    sheet: { width: project.stock.sheet.width, height: project.stock.sheet.height },
    parts: project.parts.map((part) => ({
      id: part.id,
      ...partBoxSize(part),
      qty: part.qty,
      grainLock: part.grainLock,
    })),
    gap: project.nesting.gap,
    margin: project.nesting.margin,
    toolDiameter: options.toolDiameter,
    mode: project.nesting.mode,
    locked,
    weights: options.weights,
  };
}

/** Nests a project's parts. */
export function nestProject(project: Project, options: NestProjectOptions): NestingResult {
  return nest(nestingInputFromProject(project, options));
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
}

/** Sheet count, waste % and unplaced copies of a project's current layout. Pure. */
export function summarizeLayout(project: Project): LayoutSummary {
  const sizes = new Map(project.parts.map((p) => [p.id, partBoxSize(p)]));
  const sheet = project.stock.sheet;
  const sheets = project.layout.sheets.map((sh, i) => sheetStats(i, sh.placements, sheet, sizes));
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
  return {
    sheetCount: sheets.length,
    sheets,
    partArea,
    sheetArea,
    wastePercent,
    utilisationPercent: sheetArea > 0 ? 100 - wastePercent : 0,
    unplaced,
  };
}
