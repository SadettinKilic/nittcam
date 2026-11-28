/** Post processor input and result types (spec §6.4, §7.2; T017, D-025). */
import type { MachineProfile, VerificationState } from '../machine';

export type { Point3 } from './frame';

/** The machine profile version a program is generated for (D-016 binding). */
export interface PostProfileVersion {
  profile: MachineProfile;
  /** Profile version number (`machine_profiles.version`). */
  version: number;
  /** Derived verification state of this profile version (§7.3). */
  verification: VerificationState;
}

export interface PostMeta {
  projectName: string;
  /** Saved project revision the program comes from. */
  revision: number;
  stock: {
    material: string;
    thickness: number;
    sheetWidth: number;
    sheetHeight: number;
    /**
     * Own size of a sheet, keyed by toolpath sheet index (T164, D-056). A sheet without an entry
     * (or no `sheets` at all) has `sheetWidth` × `sheetHeight`, so single-size output is unchanged.
     */
    sheets?: Readonly<Record<number, { sheetWidth: number; sheetHeight: number }>>;
  };
  /** File-name stem; default `projectName`. */
  fileStem?: string;
  /**
   * T295 (D-073): put `_r<revision>` after the stem (`<stem>_r3_S1.tap`). The revision marker is
   * kept whole like the sheet/tool markers; only the stem is shortened. Default off (goldens).
   */
  revisionInFileName?: boolean;
  /**
   * Names of the unverified ready templates in the job (T282); absent or empty = no header line,
   * so programs without such a template stay byte-identical.
   */
  unverifiedTemplates?: readonly string[];
  /**
   * D-130 / T346: the stock's kind ships NC with unverified starting values (ACM): one header line
   * "DOGRULANMAMIS MALZEME: <name>". Absent = no line (today's materials stay byte-identical).
   */
  unverifiedMaterial?: string;
  /**
   * The cutting settings the toolpath used (T288, K3): one "KESİM" header line. Absent = no line,
   * so programs made without it (golden files) stay byte-identical.
   */
  cutting?: PostCuttingMeta;
}

/** T288: tabs, lead-in and direction as the file header states them. */
export interface PostCuttingMeta {
  tabMode: 'all' | 'small' | 'off';
  tabCount: number;
  /** T294: tabs a small part really gets (the safety rule's minimum may raise `tabCount`). */
  smallTabCount?: number;
  tabWidth: number;
  tabHeight: number;
  /** Thin skin under small parts, mm; null = none. */
  skin: number | null;
  leadIn: 'arc' | 'line';
  direction: 'climb' | 'conventional';
  /**
   * T307 (D-098): the project's own spindle speeds (tool, rpm, the recommended rpm). Absent or
   * empty = every tool at its recommended value, and the line is unchanged.
   */
  spindle?: { tool: number; rpm: number; recommended: number }[];
  /**
   * T308 (D-099): the tools the project chose per operation of the job. Absent or empty = the
   * defaults, and no line is written.
   */
  tools?: { op: 'outer' | 'inner' | 'pocket' | 'hole'; tool: number }[];
  /**
   * T323: the tools the project runs at its own cutting or plunge feed (the feeds used and the
   * recommended ones), mm/min. Absent or empty = recommended feeds, and no line is written.
   */
  feeds?: {
    tool: number;
    feed: number;
    plungeFeed: number;
    recommendedFeed: number;
    recommendedPlungeFeed: number;
  }[];
  /**
   * T324: ramp entry of the contours (angle, shortest leg; absent length = the tool diameter).
   * Absent = straight plunge, and no line is written.
   */
  entry?: { angleDeg: number; length?: number };
}

export type PostCode =
  // input
  | 'INVALID_POST_CONFIG'
  | 'INVALID_PROFILE'
  | 'INVALID_META'
  | 'INVALID_TOOLPATH'
  | 'POST_MISMATCH'
  | 'STOCK_MISMATCH'
  | 'NO_OPERATIONS'
  | 'UNSUPPORTED_OPERATION'
  | 'TOOL_NOT_IN_PROFILE'
  | 'TOOL_CHANGE_UNSUPPORTED'
  // §7.2 rules
  | 'MODAL_STATE_INCOMPLETE'
  | 'SAFE_Z_INVALID'
  | 'RAPID_BELOW_SAFE_Z'
  | 'RAPID_INTO_MATERIAL'
  | 'PLUNGE_TOO_FAST'
  | 'FEED_FROM_UNKNOWN_POSITION'
  | 'SPINDLE_INVALID'
  | 'SPINDLE_NOT_READY'
  | 'FEED_INVALID'
  | 'OUT_OF_ENVELOPE'
  | 'VACUUM_OFF_MISSING'
  | 'END_SEQUENCE'
  | 'NUMBER_INVALID'
  | 'ARC_INVALID'
  | 'CHECK_FAILED'
  // files
  | 'FILE_NAME_TOO_LONG'
  | 'FILE_TOO_LARGE'
  // warnings
  | 'NO_WARMUP'
  | 'AXIS_AWAY_FROM_TABLE'
  | 'FILE_SPLIT';

export interface PostIssue {
  code: PostCode;
  severity: 'error' | 'warning';
  /** The §7.2 rule this enforces, when it is one. */
  rule?: number;
  /** English message (the UI translates by code). */
  message: string;
  operationId?: string;
  sheet?: number;
}

export interface PostFile {
  name: string;
  content: string;
  sheet: number;
  /** Tool of the file in "one file per tool" mode, else null. */
  tool: number | null;
  /** 1-based part of a split program (1 when not split). */
  part: number;
  parts: number;
}

export interface PostResult {
  /** False on any error: then `files` is empty, nothing may reach a machine. */
  ok: boolean;
  files: PostFile[];
  errors: PostIssue[];
  warnings: PostIssue[];
}

export interface GenerateOptions {
  /**
   * Rule 9 hook: the independent reader checks (T018/T019). Any error it returns refuses the
   * whole result. Download blocking itself lives in the export flow (T021).
   */
  check?: (files: readonly PostFile[]) => readonly PostIssue[];
}
