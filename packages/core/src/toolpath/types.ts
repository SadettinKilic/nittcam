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

export type OperationKind = 'outerContour';

export interface Operation {
  /** `<partId>#<copy>` (unique in the toolpath). */
  id: string;
  kind: OperationKind;
  sheet: number;
  partId: string;
  /** Copy index of the part (placement index). */
  copy: number;
  tool: number;
  toolDiameter: number;
  rpm: number;
  feed: number;
  plungeFeed: number;
  /** Travel direction of the contour passes. */
  travel: 'cw' | 'ccw';
  /** Pass depths (negative Z), last = target depth. */
  passDepths: number[];
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
  | 'TOOL_NOT_IN_PROFILE'
  | 'INVALID_OPTION'
  | 'DEPTH_EXCEEDS_FLUTE_LENGTH'
  | 'OFFSET_FAILED'
  | 'INNER_OFFSET_FAILED'
  | 'INNER_SPLIT'
  | 'INNER_CONTOURS_NOT_SUPPORTED'
  | 'HOLES_NOT_SUPPORTED'
  | 'NO_PLACEMENTS'
  | 'SAFETY_VIOLATION'
  // warnings
  | 'ARC_COLLAPSED'
  | 'LEAD_SHORTENED'
  | 'LEAD_REMOVED'
  | 'RAMP_STEEPER'
  | 'CLEARANCE_CLAMPED'
  | 'UNPLACED_COPIES';

export interface ToolpathIssue {
  code: ToolpathCode;
  severity: ToolpathSeverity;
  /** The part concerned, or null for project-wide issues. */
  partId: string | null;
  /** English message; the UI translates by `code`. */
  message: string;
  copy?: number;
  sheet?: number;
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

export interface ToolpathOptions {
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
  /** Rapid rate for the time estimate only, mm/min. Default 10 000. */
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
}
