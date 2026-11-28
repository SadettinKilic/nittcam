/**
 * Types of the automatic G-code checks (spec §6.5, §7.2; T019, D-027).
 *
 * The checks read the generated text with the independent reader (T018) and judge the read path.
 * They must not import the post processor (lint rule): the expectations they need from a post
 * config are described here structurally (`GcodeCheckPostExpectations`), so a `PostConfig` can be
 * passed as is, but no generator code or constant is shared.
 */
import type { MachineProfile, VerificationState } from '../machine';
import type { Operation, Toolpath } from '../toolpath';

/**
 * Rule ids. `R1`–`R10` are the §7.2 rules; `MODEL` = read path ≈ toolpath model, `LAYOUT` = part
 * count and positions = layout, `TOOLS` = tool-change order and tool numbers (§6.5), `INPUT` =
 * the check context itself is unusable (never a pass).
 */
export type GcodeCheckRule =
  | 'R1'
  | 'R2'
  | 'R3'
  | 'R4'
  | 'R5'
  | 'R6'
  | 'R7'
  | 'R8'
  | 'R9'
  | 'R10'
  /** T423 (§7.2 rule 12): no descent into a metal or composite panel steeper than its limit. */
  | 'R12'
  /** T354 (§7.2 rule 17): V-grooves of a composite panel (depth floor, V-bit only, every fold). */
  | 'R17'
  | 'MODEL'
  | 'LAYOUT'
  | 'TOOLS'
  | 'INPUT';

export const GCODE_CHECK_RULES: readonly GcodeCheckRule[] = [
  'R1',
  'R2',
  'R3',
  'R4',
  'R5',
  'R6',
  'R7',
  'R8',
  'R9',
  'R10',
  'R12',
  'R17',
  'MODEL',
  'LAYOUT',
  'TOOLS',
  'INPUT',
];

export interface GcodeCheckViolation {
  rule: GcodeCheckRule;
  /** Stable code (the UI translates by code). */
  code: string;
  severity: 'error' | 'warning';
  /** 1-based line of the G-code; 0 = the whole program. */
  line: number;
  /** English message. */
  message: string;
  /** File name, when the check ran over several files (`checkGcodeFiles`). */
  file?: string;
}

/**
 * What the checks need from the post config: only **declared expectations** (how the program is
 * meant to be written), never generator code. A `PostConfig` satisfies it structurally.
 */
export interface GcodeCheckPostExpectations {
  status?: 'unverified' | 'verified';
  dwell?: { unit: 's' | 'ms' };
  /** Arc distance word the post writes; chord tolerance when arcs are written as lines. */
  arcs?: { distanceModeWord: 'G90.1' | 'G91.1' | null; chordTolerance?: number };
  toolChange?: { mode: 'auto' | 'manual' | 'none'; pauseForFirstTool?: boolean };
  vacuum?: { enabled: boolean };
  /** Decimals of the written numbers: they set the comparison tolerances. */
  decimals?: { xy: number; z: number; arc: number; feed: number };
  /** The controller takes G53 (T309, D-097): only then may a park move appear. */
  motion?: { machineCoordinates?: boolean | undefined };
}

/** Where one placed part is expected (sheet frame): the centre of its outline's bounding box. */
export interface ExpectedPart {
  partId: string;
  copy: number;
  cx: number;
  cy: number;
  /**
   * False when the outline is not a through cut (T142: operation `online` or `none`): only its
   * cut-outs and through holes are expected as closed loops. Omitted = true.
   */
  outlineCut?: boolean;
  /**
   * Its cut-outs (T134), each a closed through cut of its own: the centre of the tool-centre
   * loop's bounding box, sheet frame. Omitted = none.
   */
  inners?: readonly { cx: number; cy: number }[];
  /**
   * Its through holes (T139), each cut through at its centre: a drilled hole (plunges only) or a
   * cleared through pocket (its wall ring). Omitted = none.
   */
  holes?: readonly { cx: number; cy: number }[];
  /**
   * T338 (D-129, rule PART_NOT_HELD): the placed outline as a polygon (sheet frame, arcs sampled),
   * whether it is a small part (default thresholds) and whether the project holds small parts with
   * a thin skin. Omitted = the hold rule is not checked for this part.
   */
  outline?: readonly { x: number; y: number }[];
  small?: boolean;
  skin?: boolean;
  /**
   * Its blind contour pockets (T325): inner contour index, the pocket boundary in the sheet frame
   * (a closed polygon, arcs sampled) and the declared depth (mm, positive). Every cutting move
   * inside must keep the tool inside the boundary and stay above the depth. Omitted = none.
   */
  pockets?: readonly {
    inner: number;
    boundary: readonly { x: number; y: number }[];
    depth: number;
  }[];
  /**
   * T354 (rule 17): its V-groove fold lines: an id (`line<k>` / `inner<k>`), the fold line sampled
   * in the sheet frame (arcs followed, at most 0,25 mm apart) and the groove depth from the
   * machined face (thickness − remaining, mm). Omitted = none.
   */
  grooves?: readonly { id: string; line: readonly { x: number; y: number }[]; depth: number }[];
}

export interface GcodeCheckTolerance {
  /** Endpoints, arc centres and radii, mm. Default from the post decimals, else 0.005. */
  position?: number;
  /** Feeds, mm/min. Default half a unit of the post's feed decimals, else 0.5. */
  feed?: number;
  /** Part centre against the layout, mm. Default 0.05. */
  layout?: number;
}

export interface GcodeCheckContext {
  /** Machine profile of the profile version the file is for. */
  profile: MachineProfile;
  /** Verification state of that profile version (§7.3); rule 10 needs it. */
  verification: VerificationState;
  /** Declared expectations of the post config (dwell unit, arc word, tool change, status). */
  post?: GcodeCheckPostExpectations;
  /** The expected toolpath model (sheet frame). */
  toolpath: Toolpath;
  /** Stock: thickness and sheet size (the frame conversion and the sheet limits need them). */
  stock: { thickness: number; sheetWidth: number; sheetHeight: number };
  /** Sheet the file is for (index of `layout.sheets`, = `Operation.sheet`). */
  sheet: number;
  /** Operations expected in this file, in order. Default: every operation of `sheet`. */
  operations?: readonly Operation[];
  /** Parts expected on the sheet (`expectedLayout`). Omitted or null = the layout check is skipped. */
  layout?: readonly ExpectedPart[] | null;
  /**
   * Lowest Z the program may ever reach, sheet frame (0 = material top), mm. Set for the air-cut
   * program (D-031): every move (rapids, leads, tool change, end park) must stay at or above it,
   * else `R3/AIR_CUT_BELOW_FLOOR`. Omitted = no floor (normal cutting programs).
   */
  zFloor?: number;
  /**
   * T393 (CTO #14 M1): the face the project says is machined (T348). `back`: the program header must
   * state that the sheet lies back face up and the parts are mirrored (LAYOUT/BACK_FACE_HEADER_MISSING);
   * `front`: that statement must not appear (LAYOUT/BACK_FACE_HEADER_UNEXPECTED). Omitted = not checked.
   */
  machinedFace?: 'front' | 'back';
  /**
   * T354 (rule 17): the stock's material folds (`traits.vGroove`): its minimum remaining skin, mm
   * (0,7 on ACM). No V-bit move may go below −(thickness − minRemaining). Omitted = rule 17 is
   * silent (materials without a V-groove).
   */
  vGroove?: { minRemaining: number };
  /**
   * T423 (§7.2 rule 12): the stock takes no straight plunge (`traits.entry.straightPlunge` false:
   * ACM, aluminium). Every feed move that goes down below the material top, with any tool but a
   * drill, must be at most `maxDeg` steep over its XY travel (the part below the top), else
   * `R12/STRAIGHT_PLUNGE_IN_METAL`. Omitted = rule 12 is silent (wood, plastic).
   */
  noStraightPlunge?: { maxDeg: number };
  tolerance?: GcodeCheckTolerance;
}

export interface GcodeCheckSummary {
  errors: number;
  warnings: number;
  /** Violations per rule (errors and warnings). */
  byRule: Partial<Record<GcodeCheckRule, number>>;
  /** Moves the reader found. */
  moves: number;
  /** Operations of the model matched completely by the read path. */
  matchedOperations: number;
  /** Through cuts (closed loops at the target depth) found in the read path. */
  partsCut: number;
  /** Closed through cuts the layout expects: parts plus their cut-outs (null = layout check skipped). */
  partsExpected: number | null;
}

export interface GcodeCheckResult {
  /** No error-severity violation. */
  ok: boolean;
  violations: GcodeCheckViolation[];
  summary: GcodeCheckSummary;
}

export interface GcodeCheckFile {
  name: string;
  content: string;
  sheet: number;
}

/** Context of a multi-file check: the operations and layout come per sheet. */
export type GcodeCheckFilesContext = Omit<GcodeCheckContext, 'sheet' | 'operations' | 'layout'> & {
  /** Expected parts per sheet index (`expectedLayout` for every sheet); omitted = skipped. */
  layout?: ReadonlyMap<number, readonly ExpectedPart[]> | null;
  /**
   * Own sheet size per sheet index (T164, several stock sizes). A sheet without an entry uses
   * `stock.sheetWidth` × `stock.sheetHeight`. The frame, the table fit and the sheet limits of
   * each sheet's files are checked against that sheet's size.
   */
  sheetSizes?: ReadonlyMap<number, { sheetWidth: number; sheetHeight: number }>;
};

export interface GcodeCheckFilesResult {
  ok: boolean;
  /** Every violation, each with its `file`. */
  violations: GcodeCheckViolation[];
  files: { name: string; sheet: number; result: GcodeCheckResult }[];
}
