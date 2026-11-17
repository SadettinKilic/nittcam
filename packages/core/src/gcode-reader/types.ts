/**
 * Types of the independent G-code reader (spec §6.5, T018, D-026).
 *
 * The reader is written independently of the toolpath model (T014) and the post processor (T017):
 * it must not import their code, types or constants (lint rule in `eslint.config.js`). Every length
 * is in millimetres (G20 input is converted), in the **program frame**: the coordinates as written,
 * relative to the active work offset (G54–G59); the offset values themselves are not known here.
 */

export type GcodeAxis = 'x' | 'y' | 'z';

export interface GcodePoint {
  x: number;
  y: number;
  z: number;
}

/** `arcCw` = G2, `arcCcw` = G3 (seen from +Z, plane G17). */
export type GcodeMoveType = 'rapid' | 'feed' | 'arcCw' | 'arcCcw';

export interface GcodeArc {
  /** Centre in the program frame (absolute, mm). */
  cx: number;
  cy: number;
  /** Radius from the start point, mm. */
  radius: number;
  /** Swept angle in radians, always positive, in (0, 2π]; 2π = full circle. */
  sweep: number;
  direction: 'cw' | 'ccw';
  /** How the centre was written: `ij` (I/J in the active arc distance mode) or `r` (radius). */
  form: 'ij' | 'r';
}

export interface GcodeMove {
  type: GcodeMoveType;
  from: GcodePoint;
  to: GcodePoint;
  /** Present on arc moves only. A Z change on an arc makes it helical. */
  arc?: GcodeArc;
  /** mm/min of a feed or arc move; `null` on rapids and when no F was ever given. */
  feed: number | null;
  /** True when this line wrote an F word itself (§7.2 rule 5: the first cut states its feed). */
  feedExplicit: boolean;
  spindleOn: boolean;
  rpm: number | null;
  /** Active tool (after the last M6), `null` before any tool change. */
  tool: number | null;
  /** 1-based physical line in the source text. */
  line: number;
  /** N word of the line, if any. */
  block: number | null;
  /**
   * Axes of `to` the program has never set absolutely: their value is the assumed initial
   * position (`options.initialPosition`, default 0). Empty once X, Y and Z are all known.
   */
  assumedAxes: GcodeAxis[];
}

interface EventBase {
  line: number;
  /** Index in `moves` of the next move: the event happens after `moves[moveIndex - 1]`. */
  moveIndex: number;
}

export type GcodeEvent =
  | (EventBase & { kind: 'spindle'; state: 'cw' | 'ccw' | 'off'; rpm: number | null })
  | (EventBase & { kind: 'dwell'; seconds: number })
  | (EventBase & { kind: 'toolChange'; tool: number | null })
  | (EventBase & { kind: 'pause'; optional: boolean })
  | (EventBase & { kind: 'coolant'; state: 'mist' | 'flood' | 'off' })
  /** An M code listed in `options.extraMCodes` (for example machine-specific vacuum codes). */
  | (EventBase & { kind: 'mcode'; code: number })
  /** A feed or arc move with no F defined yet (the T019 checks judge it). */
  | (EventBase & { kind: 'missingFeed' })
  | (EventBase & { kind: 'end'; code: 'M2' | 'M30' });

export type GcodeEventKind = GcodeEvent['kind'];

export type GcodeWorkOffset = 'G54' | 'G55' | 'G56' | 'G57' | 'G58' | 'G59';

export interface GcodeModalState {
  motion: 'G0' | 'G1' | 'G2' | 'G3' | null;
  plane: 'G17';
  units: 'G20' | 'G21';
  distance: 'G90' | 'G91';
  arcDistance: 'G90.1' | 'G91.1';
  wcs: GcodeWorkOffset;
  /**
   * Which modal groups the program has set itself so far. The others still have the reader's
   * assumed default (§7.2 rule 1: a program assumes no modal state).
   */
  explicit: {
    units: boolean;
    distance: boolean;
    arcDistance: boolean;
    plane: boolean;
    wcs: boolean;
  };
  /** mm/min, `null` until the first F. */
  feed: number | null;
  rpm: number | null;
  spindle: 'cw' | 'ccw' | 'off';
  /** Tool in the spindle (after M6). */
  tool: number | null;
  /** Last T word (selected, not yet changed). */
  selectedTool: number | null;
  coolant: { mist: boolean; flood: boolean };
  position: GcodePoint;
  assumedAxes: GcodeAxis[];
  /** M2/M30 has been read. */
  ended: boolean;
}

/** One entry per physical line, with the modal state **after** the line. */
export interface GcodeLine {
  line: number;
  block: number | null;
  comments: string[];
  /** Not executed: block delete, an error on the line, after the end, or after the closing `%`. */
  skipped: boolean;
  state: GcodeModalState;
}

export type GcodeIssueCode =
  // errors
  | 'EMPTY_PROGRAM'
  | 'INVALID_OPTION'
  | 'EXPONENT_NUMBER'
  | 'INVALID_NUMBER'
  | 'UNCLOSED_COMMENT'
  | 'UNEXPECTED_CHARACTER'
  | 'DUPLICATE_WORD'
  | 'MODAL_GROUP_CONFLICT'
  | 'UNSUPPORTED_PLANE'
  | 'UNSUPPORTED_CODE'
  | 'INVALID_VALUE'
  | 'NO_MOTION_MODE'
  | 'AXIS_WORD_CONFLICT'
  | 'ARC_INVALID'
  | 'ARC_RADIUS_MISMATCH'
  | 'ARC_FROM_UNKNOWN_POSITION'
  /** Error in strict mode (default), warning with `strict: false`. */
  | 'UNKNOWN_WORD'
  // warnings
  | 'IGNORED_WORD'
  | 'INCH_UNITS'
  | 'BLOCK_DELETE'
  | 'LINE_NUMBER_POSITION'
  | 'FEED_UNDEFINED'
  | 'INCREMENTAL_FROM_UNKNOWN'
  | 'TOOL_CHANGE_WITHOUT_T'
  | 'CODE_AFTER_END'
  | 'CONTENT_AFTER_END_MARKER'
  | 'NO_PROGRAM_END';

export interface GcodeIssue {
  code: GcodeIssueCode;
  severity: 'error' | 'warning';
  /** 1-based physical line; 0 = the whole program or the options. */
  line: number;
  /** English message; a UI translates by `code`. */
  message: string;
}

export interface GcodeReadOptions {
  /** Unit of `G4 P`: seconds (Mach3/LinuxCNC default) or milliseconds (Fanuc). `G4 X` is always seconds. Default `s`. */
  dwellUnit?: 's' | 'ms';
  /** Arc centre mode until G90.1/G91.1 is read. Default `G91.1` (incremental I/J). */
  arcDistanceDefault?: 'G90.1' | 'G91.1';
  /** Allowed difference of start and end radius of an arc, mm. Default `ARC_RADIUS_TOLERANCE`. */
  arcTolerance?: number;
  /** Lines starting with `/`: `skip` (default, block delete switch on) or `execute`. Both warn. */
  blockDelete?: 'skip' | 'execute';
  /** Assumed position before the program sets an axis. Default 0, 0, 0 (flagged in `assumedAxes`). */
  initialPosition?: GcodePoint;
  /** M codes reported as `mcode` events instead of `UNKNOWN_WORD` (error in strict mode). */
  extraMCodes?: readonly number[];
  /**
   * Strict mode (default true): any G or M code the reader does not model and any letter it does
   * not understand (A, B, C, E, U, V, W, …) is an `UNKNOWN_WORD` **error** and the line is not
   * run. `false` downgrades them to warnings and ignores the word, for reading foreign sample
   * files (for example the owner's Mach3 programs at field test). Never use `false` for export.
   */
  strict?: boolean;
  /** Record `lines` (one state snapshot per line). Default true. */
  snapshots?: boolean;
}

export interface GcodeReadResult {
  /** No errors. Warnings do not clear it. */
  ok: boolean;
  moves: GcodeMove[];
  events: GcodeEvent[];
  /** Empty when `options.snapshots` is false. */
  lines: GcodeLine[];
  errors: GcodeIssue[];
  warnings: GcodeIssue[];
  /** Line endings found in the text. */
  lineEnding: 'crlf' | 'lf' | 'cr' | 'mixed' | 'none';
  /** The modal state at the end of the program. */
  finalState: GcodeModalState;
}
