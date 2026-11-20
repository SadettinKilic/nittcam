/**
 * Nesting types (spec §6.2, D-019). All lengths are millimetres, areas mm². Pure data, no I/O.
 */
import type { Polyline } from '../geometry/types';
import type { Layout, NestingMode, Placement } from '../schema';

/** An axis-aligned rectangle; (x, y) is the bottom-left corner (sheet origin bottom-left, Y up). */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One part as the placer sees it: its bounding rectangle at rotation 0 in its local frame. */
export interface NestPart {
  id: string;
  /** Bounding-box width (local X) at rotation 0. */
  w: number;
  /** Bounding-box height (local Y) at rotation 0. */
  h: number;
  qty: number;
  /**
   * Allowed rotations (CCW degrees), normally from `allowedRotations` (D-034). Wins over
   * `grainLock`. A non-axis angle places the axis-aligned bbox of the rotated outline.
   */
  rotations?: readonly number[] | undefined;
  /** Short form when `rotations` is absent: true = 0°/180° only, false/absent = quarter turns. */
  grainLock?: boolean | undefined;
  /** Local outline (for the footprint at non-axis angles); absent = the w × h rectangle. */
  outline?: Polyline | undefined;
  /**
   * Tools of the part's holes, pockets and grooves (tool numbers, T162). With the input's
   * `contourTool` they are the tools one copy needs (μ·N_toolchange). Absent = none.
   */
  holeTools?: readonly number[] | undefined;
  /** Inner contours in the local frame (true-shape part-in-hole zones, T166). */
  inners?: readonly Polyline[] | undefined;
}

/**
 * Information about the result (D-034): a part placed at a non-axis angle occupies the bounding
 * box of its rotated outline until true-shape nesting (T165–T167); `extraArea` is that box minus
 * the part's own area, mm².
 */
export interface NestingInfo {
  code: 'GRAIN_ROTATED_BBOX';
  partId: string;
  index: number;
  sheet: number;
  rot: number;
  extraArea: number;
}

/**
 * Weights of the objective `min(A_waste + λ·L_cut + μ·N_toolchange + ν·C_handling)` (spec §6.2).
 * `waste` scales A_waste (mm²); `cutLength` = λ (per mm), `toolChanges` = μ (per change),
 * `handling` = ν (per handling unit). Modes are presets of these weights.
 */
export interface ObjectiveWeights {
  waste: number;
  cutLength: number;
  toolChanges: number;
  handling: number;
}

/**
 * Weight presets per mode (T162, spec §6.2: one objective, the modes are weights). Units: waste in
 * mm², cut length in mm, tool changes as a count, handling as sheets loaded.
 *
 * - `minWaste`: waste only (the D-019 placer, unchanged).
 * - `fastest`: λ = 1000 mm² per mm, so 1 m of estimated path weighs like 1 m² of board.
 * - `minToolChanges`: μ = 10⁸ mm² (100 m²) per tool change, more than any sheet's waste, so the
 *   fewest tool changes win and the waste decides between equals.
 *
 * Unplaced copies and the sheet count are compared before the objective in every mode, so no
 * mode opens an extra sheet to win its own term. ν (handling) is 0 in every preset for now.
 */
export const MODE_WEIGHTS: Readonly<Record<NestingMode, Readonly<ObjectiveWeights>>> = {
  minWaste: { waste: 1, cutLength: 0, toolChanges: 0, handling: 0 },
  fastest: { waste: 1, cutLength: 1000, toolChanges: 0, handling: 0 },
  minToolChanges: { waste: 1, cutLength: 0, toolChanges: 1e8, handling: 0 },
};

/** Everything the placer needs. Built from a project by `nestingInputFromProject`. */
export interface NestingInput {
  sheet: { width: number; height: number };
  /**
   * Stock sheet sizes in order (T164, D-056); absent or one size without `qty` = `[sheet]` (the
   * single-size path, byte-identical to before). `qty` absent = no limit.
   */
  sheets?:
    | readonly {
        width: number;
        height: number;
        qty?: number | undefined;
        /** T168: an offcut from the stock (qty 1); offcuts are tried before every other size. */
        offcutId?: string | undefined;
      }[]
    | undefined;
  /** Size index (into `sheets`) of each locked sheet; absent = 0. */
  lockedSizes?: readonly number[] | undefined;
  parts: readonly NestPart[];
  /** Gap between parts, mm (project `nesting.gap`). */
  gap: number;
  /** Sheet edge margin, mm (project `nesting.margin`). */
  margin: number;
  /** Cutting tool diameter, mm; the caller takes it from the machine profile. */
  toolDiameter: number;
  mode: NestingMode;
  /** Locked placements per sheet index; they are obstacles and are copied unchanged. */
  locked: readonly (readonly Placement[])[];
  /**
   * Tool number of the outer contours (the material set's tool, T162); absent = a contour tool
   * that differs from every hole tool.
   */
  contourTool?: number | undefined;
  /** Overrides of the mode's weight preset. */
  weights?: Partial<ObjectiveWeights> | undefined;
  /** Placer engine; absent = `maxrects` (the rectangle placer, byte-identical to before T165). */
  engine?: NestingEngine | undefined;
  /**
   * True-shape only (T166): inner contours of a part become hole zones where small parts may be
   * placed. Absent/false = every footprint is solid (conservative).
   */
  partInHole?: boolean | undefined;
}

/** Why a part copy was not placed. */
export type UnplacedReason =
  | 'TOO_LARGE'
  /** Every sheet size it fits is used up (qty limits, T164). */
  | 'NO_STOCK';

export interface UnplacedPart {
  partId: string;
  index: number;
  reason: UnplacedReason;
}

/** Part orderings tried (all descending; ties by part id, then copy index). */
export type PartOrdering =
  | 'area'
  | 'longestSide'
  | 'perimeter'
  | 'height'
  | 'width'
  /** By tool set (fewest tools first, then the set), area descending inside a set (T162). */
  | 'toolGroup';

/** Placement heuristics tried. */
export type PlacerHeuristic =
  | 'maxrects-bssf'
  | 'maxrects-baf'
  | 'maxrects-bl'
  | 'guillotine-bssf'
  | 'guillotine-baf'
  /** True-shape bottom-left placer (T165). */
  | 'trueshape-bl';

/**
 * Placer engine (T165–T167): `maxrects` = the rectangle placer (D-019, non-axis angles by the
 * rotated bbox); `trueShape` = real footprints (outline + tool radius + gap/2).
 */
export type NestingEngine = 'maxrects' | 'trueShape';

export interface SheetStats {
  index: number;
  /** Placements on the sheet (locked included). */
  placed: number;
  /** Sum of the parts' bounding-box areas, mm². */
  partArea: number;
  /** Raw sheet area width × height, mm². */
  sheetArea: number;
  /** sheetArea − partArea. */
  wasteArea: number;
  /** 100 · wasteArea / sheetArea. */
  wastePercent: number;
}

/** Terms of the objective for the chosen layout. */
export interface ObjectiveCost {
  /** Consumed material minus part area, mm² (D-019: the last sheet counts only its used strip). */
  wasteArea: number;
  /**
   * Estimated XY path, mm (T162): outer contour lengths of all placed copies plus the travel
   * between them in the cut order of the toolpath model (`cutOrder` from the sheet origin, no
   * 2-opt). Only the travel depends on the layout.
   */
  cutLength: number;
  /** Per sheet the distinct tools its copies need minus one (each sheet is its own program). */
  toolChanges: number;
  /** Sheets loaded. */
  handling: number;
  /** Weighted sum. */
  total: number;
}

export interface NestingResult {
  layout: Layout;
  sheetCount: number;
  sheets: SheetStats[];
  /** Total part area over all sheets, mm². */
  partArea: number;
  /** sheetCount × sheet area, mm². */
  sheetArea: number;
  /** Overall waste %, 100 · (sheetArea − partArea) / sheetArea; 0 with no sheets. */
  wastePercent: number;
  /** 100 − wastePercent (0 with no sheets). */
  utilisationPercent: number;
  unplaced: UnplacedPart[];
  cost: ObjectiveCost;
  /** The winning ordering and heuristic. */
  strategy: { ordering: PartOrdering; heuristic: PlacerHeuristic };
  /** How many ordering × heuristic candidates were tried. */
  candidates: number;
  /** Notes on the layout (no errors): rotated-bbox footprints (D-034). */
  info: NestingInfo[];
}
