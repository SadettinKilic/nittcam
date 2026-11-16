/**
 * Nesting types (spec §6.2, D-019). All lengths are millimetres, areas mm². Pure data, no I/O.
 */
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
  /** Grain-locked parts only rotate 0°/180°: for a rectangle that means never 90° (spec §6.2). */
  grainLock: boolean;
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
 * Weight presets per mode. T012 implements min-waste only: cut length, tool changes and handling
 * are not measured yet (toolpath is T014+), so their terms are 0 and every mode ranks like
 * min-waste until those terms exist. The λ/μ/ν values are placeholders to be tuned then.
 */
export const MODE_WEIGHTS: Readonly<Record<NestingMode, Readonly<ObjectiveWeights>>> = {
  minWaste: { waste: 1, cutLength: 0, toolChanges: 0, handling: 0 },
  fastest: { waste: 1, cutLength: 0, toolChanges: 0, handling: 0 },
  minToolChanges: { waste: 1, cutLength: 0, toolChanges: 0, handling: 0 },
};

/** Everything the placer needs. Built from a project by `nestingInputFromProject`. */
export interface NestingInput {
  sheet: { width: number; height: number };
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
  /** Overrides of the mode's weight preset. */
  weights?: Partial<ObjectiveWeights> | undefined;
}

/** Why a part copy was not placed. */
export type UnplacedReason = 'TOO_LARGE';

export interface UnplacedPart {
  partId: string;
  index: number;
  reason: UnplacedReason;
}

/** Part orderings tried (all descending; ties by part id, then copy index). */
export type PartOrdering = 'area' | 'longestSide' | 'perimeter' | 'height' | 'width';

/** Placement heuristics tried. */
export type PlacerHeuristic =
  'maxrects-bssf' | 'maxrects-baf' | 'maxrects-bl' | 'guillotine-bssf' | 'guillotine-baf';

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
  /** Not measured yet (T014+): 0. */
  cutLength: number;
  /** Not measured yet: 0. */
  toolChanges: number;
  /** Not measured yet: 0. */
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
}
