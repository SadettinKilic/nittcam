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
}

/** Where one placed part is expected (sheet frame): the centre of its outline's bounding box. */
export interface ExpectedPart {
  partId: string;
  copy: number;
  cx: number;
  cy: number;
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
  /** Parts the layout expects (null when the layout check was skipped). */
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
};

export interface GcodeCheckFilesResult {
  ok: boolean;
  /** Every violation, each with its `file`. */
  violations: GcodeCheckViolation[];
  files: { name: string; sheet: number; result: GcodeCheckResult }[];
}
