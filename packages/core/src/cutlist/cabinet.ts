/**
 * Parametric cabinet box (T122, spec §4.1 "Parametrik dolap kutusu", D-041). Pure.
 *
 * Turns a few box sizes into plain rectangle cut-list rows: sides, top, bottom, shelves, back,
 * doors and a plinth board. No joinery (spec §2.5). The generator only seeds rows: the result is
 * fed to `importCutList` and nothing links the rows back to these parameters.
 *
 * Construction (all mm; W × H × D = outside width, height, depth including the back):
 * - sides stand on the floor: D' × H, two of them (D' = D, or D − back for an overlay back);
 * - top and bottom sit between the sides: (W − 2t) × depth; the bottom is raised by the plinth;
 * - depth of top / bottom / shelves = D − back thickness when there is a back, else D;
 * - inset back: (W − 2t) × (H − plinth), behind top and bottom, between the sides;
 * - overlay back: W × H, on the back edges of the whole box;
 * - shelves (fixed): (W − 2t) × depth, one row with qty = count;
 * - doors (overlay, on the front): gap g around and between them over the height H − plinth;
 *   one door (W − 2g) × (H − plinth − 2g), two doors ((W − 3g) / 2) × (H − plinth − 2g);
 * - plinth board (front kick board) when plinth > 0: (W − 2t) × plinth.
 * Grain: sides and doors vertical, top / bottom / shelves / plinth along the width (fixed);
 * the back is free. Edge band: the visible front edge of carcass parts, all four door edges.
 */
import { z } from 'zod';

const mm = z.number({ error: 'must be a number (mm)' });

export const cabinetParamsSchema = z.strictObject({
  width: mm.positive().max(5000),
  height: mm.positive().max(5000),
  depth: mm.positive().max(2000),
  /** Board thickness of the carcass and the doors. */
  thickness: mm.positive().max(100),
  back: z.strictObject({
    mode: z.enum(['none', 'inset', 'overlay']),
    thickness: mm.positive().max(50),
  }),
  shelves: z.number().int().min(0).max(20),
  doors: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  doorGap: mm.min(0).max(20),
  plinth: mm.min(0).max(500),
  /** Edge band thickness put on the visible edges; 0 = none. */
  band: mm.min(0).max(5),
});
export type CabinetParams = z.infer<typeof cabinetParamsSchema>;

/** Sensible defaults: a 600 × 720 × 560 base unit in 18 mm board with an 8 mm inset back. */
export const DEFAULT_CABINET: CabinetParams = {
  width: 600,
  height: 720,
  depth: 560,
  thickness: 18,
  back: { mode: 'inset', thickness: 8 },
  shelves: 1,
  doors: 1,
  doorGap: 3,
  plinth: 0,
  band: 1,
};

export type CabinetPartRole = 'side' | 'top' | 'bottom' | 'shelf' | 'back' | 'door' | 'plinth';

/** One generated row, ready for `importCutList` once the caller adds an id, name and group. */
export interface CabinetPart {
  role: CabinetPartRole;
  qty: number;
  /** Along X / Y of the part, mm. */
  w: number;
  h: number;
  grain: { mode: 'fixed' | 'free'; angle: number };
  edgeBand: { top: number; right: number; bottom: number; left: number };
  /** Board thickness of this part, mm (the back may differ from the carcass, T260). */
  thickness: number;
}

export type CabinetError = 'tooNarrow' | 'tooLow' | 'tooShallow' | 'doorsTooSmall';

export type CabinetResult = { ok: true; parts: CabinetPart[] } | { ok: false; error: CabinetError };

const round = (v: number) => Math.round(v * 100) / 100;
const NONE = { top: 0, right: 0, bottom: 0, left: 0 };

/** The rows of a cabinet box, in a fixed order (sides, top, bottom, shelves, back, doors, plinth). */
export function cabinetParts(params: CabinetParams): CabinetResult {
  const { width: W, height: H, depth: D, thickness: t, back, shelves, doors, doorGap: g } = params;
  const p = params.plinth;
  const b = params.band;
  const bt = back.mode === 'none' ? 0 : back.thickness;
  const inner = W - 2 * t;
  const sideDepth = back.mode === 'overlay' ? D - bt : D;
  const depth = D - bt;
  if (inner <= 0) return { ok: false, error: 'tooNarrow' };
  if (H - p - 2 * t <= 0) return { ok: false, error: 'tooLow' };
  if (depth <= 0 || sideDepth <= 0) return { ok: false, error: 'tooShallow' };

  const along = { mode: 'fixed' as const, angle: 0 };
  const vertical = { mode: 'fixed' as const, angle: 90 };
  // Front edge: sides are D × H (front = left edge), shelves etc. are inner × depth (front = bottom).
  const sideBand = { ...NONE, left: b };
  const frontBand = { ...NONE, bottom: b };
  const parts: Omit<CabinetPart, 'thickness'>[] = [
    { role: 'side', qty: 2, w: sideDepth, h: H, grain: vertical, edgeBand: sideBand },
    { role: 'top', qty: 1, w: inner, h: depth, grain: along, edgeBand: frontBand },
    { role: 'bottom', qty: 1, w: inner, h: depth, grain: along, edgeBand: frontBand },
  ];
  if (shelves > 0) {
    parts.push({
      role: 'shelf',
      qty: shelves,
      w: inner,
      h: depth,
      grain: along,
      edgeBand: frontBand,
    });
  }
  if (back.mode === 'inset') {
    parts.push({
      role: 'back',
      qty: 1,
      w: inner,
      h: H - p,
      grain: { mode: 'free', angle: 0 },
      edgeBand: NONE,
    });
  } else if (back.mode === 'overlay') {
    parts.push({
      role: 'back',
      qty: 1,
      w: W,
      h: H,
      grain: { mode: 'free', angle: 0 },
      edgeBand: NONE,
    });
  }
  if (doors > 0) {
    const dw = doors === 1 ? W - 2 * g : (W - 3 * g) / 2;
    const dh = H - p - 2 * g;
    if (dw <= 0 || dh <= 0) return { ok: false, error: 'doorsTooSmall' };
    const all = { top: b, right: b, bottom: b, left: b };
    parts.push({ role: 'door', qty: doors, w: dw, h: dh, grain: vertical, edgeBand: all });
  }
  if (p > 0) parts.push({ role: 'plinth', qty: 1, w: inner, h: p, grain: along, edgeBand: NONE });
  return {
    ok: true,
    parts: parts.map((x) => ({
      ...x,
      w: round(x.w),
      h: round(x.h),
      edgeBand: { ...x.edgeBand },
      thickness: x.role === 'back' ? bt : t,
    })),
  };
}

/** A rectangle of the 2D front view (x right, y up from the floor), mm. */
export interface FrontRect {
  role: CabinetPartRole;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Front view of the box for the dialog's live mini preview: carcass parts (sides, top, bottom,
 * evenly spaced shelves, plinth) and the door outlines drawn over them. Empty when invalid.
 */
export function cabinetFrontView(params: CabinetParams): FrontRect[] {
  const r = cabinetParts(params);
  if (!r.ok) return [];
  const { width: W, height: H, thickness: t, shelves, doors, doorGap: g } = params;
  const p = params.plinth;
  const inner = W - 2 * t;
  const out: FrontRect[] = [
    { role: 'side', x: 0, y: 0, w: t, h: H },
    { role: 'side', x: W - t, y: 0, w: t, h: H },
    { role: 'bottom', x: t, y: p, w: inner, h: t },
    { role: 'top', x: t, y: H - t, w: inner, h: t },
  ];
  const space = H - p - 2 * t;
  for (let i = 1; i <= shelves; i++) {
    const y = p + t + (space * i) / (shelves + 1) - t / 2;
    out.push({ role: 'shelf', x: t, y, w: inner, h: t });
  }
  if (p > 0) out.push({ role: 'plinth', x: t, y: 0, w: inner, h: p });
  if (doors > 0) {
    const dw = doors === 1 ? W - 2 * g : (W - 3 * g) / 2;
    for (let i = 0; i < doors; i++) {
      out.push({ role: 'door', x: g + i * (dw + g), y: p + g, w: dw, h: H - p - 2 * g });
    }
  }
  return out;
}

/** Cabinet parts split by what the project's stock can make (T260, D-045). */
export interface CabinetStockSplit {
  /** Parts to add: those in the stock's thickness, plus the others when asked for. */
  rows: CabinetPart[];
  /** Parts in another thickness (e.g. an 8 mm back for an 18 mm list); never added silently. */
  other: CabinetPart[];
}

/**
 * Fits generated parts to the project's stock (D-045 "generators respect the stock"): parts of
 * another thickness are left out unless `includeOther`; on a stock without grain every row is
 * free to rotate (a fixed grain would only constrain nesting for nothing).
 */
export function cabinetPartsForStock(
  parts: readonly CabinetPart[],
  stock: { thickness: number; hasGrain: boolean },
  includeOther = false,
): CabinetStockSplit {
  const same = (p: CabinetPart) => Math.abs(p.thickness - stock.thickness) <= 1e-6;
  const fit = (p: CabinetPart): CabinetPart =>
    stock.hasGrain ? p : { ...p, grain: { mode: 'free', angle: 0 } };
  const other = parts.filter((p) => !same(p)).map(fit);
  const rows = parts.filter((p) => includeOther || same(p)).map(fit);
  return { rows, other };
}
