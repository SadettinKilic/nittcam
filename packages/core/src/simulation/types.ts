/**
 * Simulation model (spec §6.5, T020, D-028). Built from the **read** G-code (the independent
 * reader's moves), converted back to the sheet frame, so the screen shows what the machine will
 * actually do, not what the toolpath model intended.
 */

/** One read move as a playback step. Time is in seconds from the start of the sheet's program(s). */
export interface SimStep {
  kind: 'rapid' | 'cut';
  /** Index into `SimSheet.files`. */
  file: number;
  /** 1-based line of the move in its file. */
  line: number;
  /**
   * Point range in `SimSheet.points` (point indices, not array offsets): the step runs from point
   * `p0` (where the previous step ended) to point `p1`. Arcs are sampled into several points.
   */
  p0: number;
  p1: number;
  /** Start and end time, s. `t0` may be later than the previous step's `t1` (dwell before it). */
  t0: number;
  t1: number;
  /** Path length, mm (helical length for arcs that change Z). */
  length: number;
  /** mm/min; null for rapids. */
  feed: number | null;
  /** Lowest sheet Z along the step (Z 0 = material top, negative = into the material). */
  zMin: number;
  /** Cut-order number of the contour this cut belongs to (from 1); 0 for rapids. */
  contour: number;
  /** False when the step starts from a position the program never set (drawn without its XY). */
  known: boolean;
  /** Tool number the program has in the spindle (M6 or the manual change prompt); null = unknown. */
  tool: number | null;
  /**
   * A tab (bridge): a level cut above the final depth after its contour has reached the final
   * depth (the tool rises over the bridge and plunges back, D-022). Drawn with a marker.
   */
  tab: boolean;
}

/** Start of a contour (a run of cuts between two rapids): its cut-order number and position. */
export interface SimContour {
  n: number;
  /** Index of its first cut step. */
  step: number;
  x: number;
  y: number;
  /** Time at which the contour starts, s. */
  t: number;
}

export interface SimFile {
  name: string;
  /** The program text split into physical lines (line k = `lines[k - 1]`). */
  lines: string[];
}

export interface SimTotals {
  /** Approximate machining time, s: feed moves at their feed, rapids at the rapid feed, dwells. */
  seconds: number;
  cutLength: number;
  rapidLength: number;
  /** M6 tool changes plus manual tool change stops (M0/M1). */
  toolChanges: number;
  dwellSeconds: number;
  moves: number;
}

/** Playback data of one sheet (all of its files in order). */
export interface SimSheet {
  /** Index of `layout.sheets`. */
  sheet: number;
  files: SimFile[];
  /** Flat x, y, z triples in the sheet frame, mm. Point k = `points[3k..3k+2]`. */
  points: number[];
  steps: SimStep[];
  contours: SimContour[];
  /** End time of the last step, s. */
  duration: number;
  totals: SimTotals;
  /** Deepest Z of any cut (the final depth), ≤ 0. */
  zBottom: number;
  /** Tool diameter per tool number found in the program (from the profile). */
  toolDiameters: Record<number, number>;
}

/** Machine geometry in the sheet frame, for drawing the table, the travel and the program zero. */
export interface SimMachineFrame {
  /** Program zero (X0 Y0) in the sheet frame. */
  zero: { x: number; y: number };
  /** Direction of machine +X / +Y in the sheet frame (1 = sheet +X / +Y). */
  xSign: 1 | -1;
  ySign: 1 | -1;
  /** Table surface rectangle in the sheet frame. */
  table: { x: number; y: number; width: number; height: number };
  /** XY travel (work envelope) rectangle in the sheet frame. */
  envelope: { x: number; y: number; width: number; height: number };
}

export interface SimSummary extends SimTotals {
  /** Pass count and tab count of the toolpath that produced the program. */
  passes: number;
  tabs: number;
  files: number;
  sheets: number;
  /** Rapid feed used for the estimate, mm/min. */
  rapidFeed: number;
}
