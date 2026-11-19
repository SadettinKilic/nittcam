/**
 * Machine-independent toolpath model (spec §6.3, T014, D-021).
 *
 * Every coordinate is absolute, in millimetres, in the **sheet frame**: origin at the bottom-left
 * corner of the sheet, X right, Y up, Z = 0 at the material top, negative down (spec §6.1). No
 * machine origin or Z-zero conversion happens here; that is the post processor's job (T017).
 *
 * A move describes where it ends; it starts where the previous move ended.
 */

/** Rapid (G0): only allowed for XY at safe Z, or for Z above the material. */
export interface RapidMove {
  kind: 'rapid';
  x: number;
  y: number;
  z: number;
}

/** Straight vertical feed move into (or towards) the material at the plunge feed. */
export interface PlungeMove {
  kind: 'plunge';
  x: number;
  y: number;
  z: number;
  /** mm/min; always the plunge feed. */
  feed: number;
}

/** Straight feed move (G1); may change Z (ramp). */
export interface LinearMove {
  kind: 'linear';
  x: number;
  y: number;
  z: number;
  /** mm/min. */
  feed: number;
}

/** Circular feed move (G2/G3) in the XY plane; a Z change makes it helical (ramp). */
export interface ArcMove {
  kind: 'arc';
  x: number;
  y: number;
  z: number;
  /** Arc centre (absolute, sheet frame). */
  cx: number;
  cy: number;
  /** `cw` = G2, `ccw` = G3 (seen from +Z). */
  direction: 'cw' | 'ccw';
  /** tan(θ/4) of the signed sweep (+ = CCW), same as the geometry kernel. */
  bulge: number;
  /** mm/min. */
  feed: number;
}

export type FeedMove = PlungeMove | LinearMove | ArcMove;
export type Move = RapidMove | FeedMove;

/**
 * What a group of moves is for. The final pass is its own segment so tabs (T015) can be inserted
 * into it without touching the rest.
 */
export type SegmentRole = 'approach' | 'leadIn' | 'pass' | 'leadOut' | 'retract';

export interface MoveSegment {
  role: SegmentRole;
  /** 0-based pass index for `pass` segments. */
  pass?: number;
  /** Z of the pass (negative) for `pass` segments. */
  depth?: number;
  /** True on the last (through-cut) pass: the tab hook (T015). */
  final?: boolean;
  moves: Move[];
}

/**
 * One tab (T015, D-022) on the passes below the tab top. Positions are arc lengths along the
 * tool-centre loop from the start point in the travel direction; the raised span [start, end] is
 * flown at `z` (= −(thickness − tab height)) and is `width + tool diameter` long.
 */
export interface Tab {
  centre: number;
  start: number;
  end: number;
  /** XY where the tool rises (start) and goes back down (end). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Tab top Z. */
  z: number;
}

/**
 * `outerContour`: a part's outer contour (T014). `innerContour`: a cut-out (T134), cut before it.
 * `pocket`: a circular pocket cleared from its centre
 * with concentric rings (the test part of T022, D-031, and the holes of §4.5: through and blind,
 * T139–T140); down to the target depth it is a through hole. `drill`: a hole as wide as the tool,
 * one plunge per pass (peck, D-050). `groove`: a ring groove around the hole's centreline (T140).
 */
export type OperationKind =
  'outerContour' | 'innerContour' | 'pocket' | 'drill' | 'groove' | 'online';

export interface Operation {
  /** `<partId>#<copy>` (unique in the toolpath). */
  id: string;
  kind: OperationKind;
  sheet: number;
  partId: string;
  /** Copy index of the part (placement index). */
  copy: number;
  /**
   * Thin-skin cleanup pass (T143): cuts the skin left under a small part through; the last
   * operations of the sheet. Absent = a normal operation.
   */
  skinCleanup?: true;
  /** The part's hole this operation cuts (hole operations only). */
  holeId?: string;
  tool: number;
  toolDiameter: number;
  rpm: number;
  feed: number;
  plungeFeed: number;
  /** Travel direction of the contour passes. */
  travel: 'cw' | 'ccw';
  /** Pass depths (negative Z), last = target depth. */
  passDepths: number[];
  /** Tabs (empty = none); applied to every pass deeper than the tab top (D-022). */
  tabs: Tab[];
  /** Approach, lead-in, passes (one per depth), lead-out, retract. Starts and ends at safe Z. */
  segments: MoveSegment[];
}

export interface ToolpathSummary {
  /** Length of all feed moves (plunge, linear, arc; helical length for ramps), mm. */
  cutLength: number;
  /** Length of all rapids within a sheet, mm. */
  rapidLength: number;
  /** Approximate machining time, seconds (feed moves at their feed, rapids at `rapidFeed`). */
  estimatedSeconds: number;
  operationCount: number;
}

export interface Toolpath {
  units: 'mm';
  frame: 'sheet';
  safeZ: number;
  clearanceZ: number;
  /** −(thickness + spoilboard allowance). */
  targetDepth: number;
  operations: Operation[];
}

export type ToolpathSeverity = 'error' | 'warning';

export type ToolpathCode =
  // errors (block export)
  | 'NO_CUTTING_PARAMS'
  | 'CUTTING_PARAMS_UNVERIFIED'
  | 'TOOL_NOT_IN_PROFILE'
  | 'INVALID_OPTION'
  | 'DEPTH_EXCEEDS_FLUTE_LENGTH'
  | 'OFFSET_FAILED'
  | 'INNER_OFFSET_FAILED'
  | 'INNER_SPLIT'
  | 'ONLINE_DEPTH_INVALID'
  | 'INVALID_SKIN'
  | 'SMALL_PART_SKIN'
  | 'INNER_CONTOUR_INVALID'
  | 'HOLE_OUTSIDE_PART'
  | 'HOLE_SMALLER_THAN_TOOL'
  | 'GROOVE_NARROWER_THAN_TOOL'
  | 'HOLE_DEPTH_INVALID'
  | 'NO_PLACEMENTS'
  | 'SAFETY_VIOLATION'
  | 'INVALID_TAB'
  | 'SMALL_PART_UNSECURED'
  | 'SMALL_SLUG_UNSECURED'
  // warnings
  | 'ARC_COLLAPSED'
  | 'LEAD_SHORTENED'
  | 'LEAD_REMOVED'
  | 'RAMP_STEEPER'
  | 'CLEARANCE_CLAMPED'
  | 'UNPLACED_COPIES'
  | 'SMALL_PART_AUTO_TABS'
  | 'SMALL_SLUG_AUTO_TABS'
  | 'TABS_REDUCED'
  | 'TABS_NOT_PLACED';

export interface ToolpathIssue {
  code: ToolpathCode;
  severity: ToolpathSeverity;
  /** The part concerned, or null for project-wide issues. */
  partId: string | null;
  /** English message; the UI translates by `code`. */
  message: string;
  copy?: number;
  sheet?: number;
  /** Inner contour index (0-based) of the part, for issues about a cut-out (T270). */
  inner?: number;
}

export type LeadType = 'arc' | 'line' | 'none';

export type PlungeOption =
  | { type: 'straight' }
  /**
   * Zig-zag ramp along the contour: forward over `length` mm, back to the start point, reaching
   * the pass depth there. `length` wins over `angleDeg` (angle of each leg against the XY plane).
   */
  | { type: 'ramp'; angleDeg?: number; length?: number };

/** Overrides of the material parameter set (spec §7.1 "Kesim parametreleri"). */
export interface CuttingParamsOverride {
  tool?: number;
  feed?: number;
  plungeFeed?: number;
  rpm?: number;
  passDepth?: number;
}

/**
 * Tab settings (D-022). Each field overrides `project.cutting.tabs`, which overrides the material
 * parameter set's tab defaults, which override `TAB_DEFAULTS`.
 */
export interface TabOptions {
  /** true = tabs on every part; false = only on small parts. */
  auto?: boolean;
  count?: number;
  /** Bridge width along the contour, mm. */
  width?: number;
  /** Material left in the bridge, mm; tab top = −(thickness − height). */
  height?: number;
  /** Small-part area threshold, mm² (default 50 000 = 0.05 m²). */
  smallPartArea?: number;
  /** Small-part smaller-side threshold, mm (default 100). */
  smallPartMinSide?: number;
}

/** Cut order options (T016, D-023). */
export interface CutOrderOptionsInput {
  /** Ordering preset; default `project.nesting.mode`. */
  mode?: 'minWaste' | 'fastest' | 'minToolChanges';
  /** 2-opt tour evaluations per sheet; default per mode. 0 = no 2-opt. */
  maxEvaluations?: number;
}

/**
 * Rapid travel between operations as the cut order measures it (D-023): XY distance from the sheet
 * origin through every operation's start point, summed over the sheets, mm.
 */
export interface CutOrderSummary {
  mode: 'minWaste' | 'fastest' | 'minToolChanges';
  /** Placement order (the T014 order) with the default start points. */
  placementRapid: number;
  /** Naive order that obeys the cut-order rules (ties by placement order, default start points). */
  naiveRapid: number;
  /** The chosen order and start points; never more than `naiveRapid`. */
  rapid: number;
  /** Tool changes within the sheets (the first tool of a sheet is not counted). */
  toolChanges: number;
}

export interface ToolpathOptions {
  tabs?: TabOptions;
  order?: CutOrderOptionsInput;
  /** Default: `project.cutting.leadIn`. */
  lead?: LeadType;
  /** Lead arc radius / lead line length, mm. Default: tool radius. */
  leadLength?: number;
  /** Default: straight. */
  plunge?: PlungeOption;
  /** Default: `project.cutting.direction`. */
  direction?: 'climb' | 'conventional';
  /** Height above the material top the rapid descends to before plunging, mm. Default 2. */
  clearance?: number;
  /** Rapid rate for the time estimate only, mm/min. Default: the profile's `rapidFeed`, else 10 000. */
  rapidFeed?: number;
  cutting?: CuttingParamsOverride;
}

export interface ToolpathResult {
  /** False when any error is present: the toolpath must not be exported. */
  ok: boolean;
  toolpath: Toolpath;
  warnings: ToolpathIssue[];
  errors: ToolpathIssue[];
  summary: ToolpathSummary;
  order: CutOrderSummary;
}
