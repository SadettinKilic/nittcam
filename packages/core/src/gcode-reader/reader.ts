/**
 * Independent G-code reader (spec §6.5, §7.2, T018, D-026).
 *
 * `readGcode(text, options)` lexes each line, runs a modal state machine (RS-274 subset for
 * 3-axis routers, plane G17) and returns the moves, events, one state snapshot per line, errors
 * and warnings. It never throws on input text. It does **not** judge safety (that is T019): it
 * reports what the controller would do, and flags what it cannot read reliably as errors.
 *
 * This module must not import the toolpath model or the post processor (lint rule): an
 * independent second implementation is a safety property (§6.5).
 */
import { EPS } from '../geometry/constants';
import { ARC_RADIUS_TOLERANCE, arcFromCentre, arcFromRadius, type ArcResult } from './arc';
import { lexLine, type Word } from './lexer';
import type {
  GcodeAxis,
  GcodeEvent,
  GcodeIssue,
  GcodeIssueCode,
  GcodeLine,
  GcodeModalState,
  GcodeMove,
  GcodePoint,
  GcodeReadOptions,
  GcodeReadResult,
  GcodeWorkOffset,
} from './types';

const INCH = 25.4;

/** G codes as `round(value × 10)`: G1 = 10, G90.1 = 901. */
const MOTION: Record<number, GcodeModalState['motion']> = { 0: 'G0', 10: 'G1', 20: 'G2', 30: 'G3' };
const WCS: Record<number, GcodeWorkOffset> = {
  540: 'G54',
  550: 'G55',
  560: 'G56',
  570: 'G57',
  580: 'G58',
  590: 'G59',
};

/** Modal group of each supported G code (conflicts inside one block are errors). */
const G_GROUP: Record<number, string> = {
  0: 'motion',
  10: 'motion',
  20: 'motion',
  30: 'motion',
  40: 'motion', // G4 is non-modal, but it uses the axis words like a motion
  170: 'plane',
  180: 'plane',
  190: 'plane',
  200: 'units',
  210: 'units',
  900: 'distance',
  910: 'distance',
  901: 'arcDistance',
  911: 'arcDistance',
  400: 'cutterComp',
  490: 'toolLength',
  540: 'wcs',
  550: 'wcs',
  560: 'wcs',
  570: 'wcs',
  580: 'wcs',
  590: 'wcs',
  610: 'pathMode',
  640: 'pathMode',
  800: 'cycle',
  940: 'feedMode',
};

/**
 * Codes that change geometry, position or program flow in ways this reader does not model.
 * Reading past them would give a wrong path, so they are errors, not unknown-word warnings.
 */
const G_UNSUPPORTED: Record<number, string> = {
  100: 'G10 (offset setting)',
  120: 'G12 (circular pocket)',
  130: 'G13 (circular pocket)',
  150: 'G15 (polar coordinates)',
  160: 'G16 (polar coordinates)',
  280: 'G28 (return home)',
  281: 'G28.1',
  300: 'G30 (return home)',
  382: 'G38.2 (probe)',
  410: 'G41 (cutter compensation)',
  420: 'G42 (cutter compensation)',
  430: 'G43 (tool length offset)',
  510: 'G51 (scaling)',
  520: 'G52 (local offset)',
  530: 'G53 (machine coordinates)',
  541: 'G54.1 (extra work offsets)',
  680: 'G68 (rotation)',
  730: 'G73 (drill cycle)',
  760: 'G76 (cycle)',
  810: 'G81 (drill cycle)',
  820: 'G82 (drill cycle)',
  830: 'G83 (drill cycle)',
  840: 'G84 (tap cycle)',
  850: 'G85 (cycle)',
  860: 'G86 (cycle)',
  870: 'G87 (cycle)',
  880: 'G88 (cycle)',
  890: 'G89 (cycle)',
  920: 'G92 (coordinate offset)',
  921: 'G92.1',
  922: 'G92.2',
  923: 'G92.3',
  930: 'G93 (inverse time feed)',
  950: 'G95 (feed per revolution)',
};

const M_UNSUPPORTED: Record<number, string> = {
  47: 'M47 (repeat program)',
  98: 'M98 (subprogram call)',
  99: 'M99 (subprogram return)',
};

const M_GROUP: Record<number, string> = {
  0: 'stop',
  1: 'stop',
  2: 'stop',
  30: 'stop',
  3: 'spindle',
  4: 'spindle',
  5: 'spindle',
  6: 'toolChange',
  7: 'coolant',
  8: 'coolant',
  9: 'coolantOff',
};

/** Letters that take a single value per block. */
const VALUE_LETTERS = new Set(['X', 'Y', 'Z', 'I', 'J', 'K', 'R', 'F', 'S', 'T', 'P', 'N', 'O']);

function initialState(start: GcodePoint, arcDefault: 'G90.1' | 'G91.1'): GcodeModalState {
  return {
    motion: null,
    plane: 'G17',
    units: 'G21',
    distance: 'G90',
    arcDistance: arcDefault,
    wcs: 'G54',
    explicit: { units: false, distance: false, arcDistance: false, plane: false, wcs: false },
    feed: null,
    rpm: null,
    spindle: 'off',
    tool: null,
    selectedTool: null,
    coolant: { mist: false, flood: false },
    position: { ...start },
    assumedAxes: ['x', 'y', 'z'],
    ended: false,
  };
}

function snapshot(s: GcodeModalState): GcodeModalState {
  return {
    ...s,
    explicit: { ...s.explicit },
    coolant: { ...s.coolant },
    position: { ...s.position },
    assumedAxes: [...s.assumedAxes],
  };
}

function detectLineEnding(text: string): GcodeReadResult['lineEnding'] {
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        crlf++;
        i++;
      } else cr++;
    } else if (c === 10) lf++;
  }
  const kinds = (crlf > 0 ? 1 : 0) + (lf > 0 ? 1 : 0) + (cr > 0 ? 1 : 0);
  if (kinds === 0) return 'none';
  if (kinds > 1) return 'mixed';
  return crlf > 0 ? 'crlf' : lf > 0 ? 'lf' : 'cr';
}

const ERROR_CODES = new Set<GcodeIssueCode>([
  'EMPTY_PROGRAM',
  'INVALID_OPTION',
  'EXPONENT_NUMBER',
  'INVALID_NUMBER',
  'UNCLOSED_COMMENT',
  'UNEXPECTED_CHARACTER',
  'DUPLICATE_WORD',
  'MODAL_GROUP_CONFLICT',
  'UNSUPPORTED_PLANE',
  'UNSUPPORTED_CODE',
  'INVALID_VALUE',
  'NO_MOTION_MODE',
  'AXIS_WORD_CONFLICT',
  'ARC_INVALID',
  'ARC_RADIUS_MISMATCH',
  'ARC_FROM_UNKNOWN_POSITION',
  'UNKNOWN_WORD',
]);

/**
 * Severity of an issue code (errors make `ok` false). `UNKNOWN_WORD` is an error in strict mode
 * (the default) and a warning with `strict: false`.
 */
export function gcodeIssueSeverity(code: GcodeIssueCode, strict = true): 'error' | 'warning' {
  if (code === 'UNKNOWN_WORD' && !strict) return 'warning';
  return ERROR_CODES.has(code) ? 'error' : 'warning';
}

function finitePoint(p: GcodePoint | undefined): boolean {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
}

/** Reads a G-code program. Never throws on text input; see the module comment. */
export function readGcode(text: string, options: GcodeReadOptions = {}): GcodeReadResult {
  const errors: GcodeIssue[] = [];
  const warnings: GcodeIssue[] = [];
  function issue0(message: string): void {
    errors.push({ code: 'INVALID_OPTION', severity: 'error', line: 0, message });
  }
  const strict = options.strict ?? true;
  if (typeof strict !== 'boolean') issue0('strict must be a boolean');
  const issue = (code: GcodeIssueCode, line: number, message: string): void => {
    const severity = gcodeIssueSeverity(code, strict !== false);
    (severity === 'error' ? errors : warnings).push({ code, severity, line, message });
  };

  const dwellUnit = options.dwellUnit ?? 's';
  if (dwellUnit !== 's' && dwellUnit !== 'ms') {
    issue('INVALID_OPTION', 0, 'dwellUnit must be "s" or "ms"');
  }
  const arcDefault = options.arcDistanceDefault ?? 'G91.1';
  if (arcDefault !== 'G90.1' && arcDefault !== 'G91.1') {
    issue('INVALID_OPTION', 0, 'arcDistanceDefault must be "G90.1" or "G91.1"');
  }
  let arcTol = options.arcTolerance ?? ARC_RADIUS_TOLERANCE;
  if (!Number.isFinite(arcTol) || arcTol < 0) {
    issue('INVALID_OPTION', 0, 'arcTolerance must be a finite number ≥ 0');
    arcTol = ARC_RADIUS_TOLERANCE;
  }
  const blockDeleteMode = options.blockDelete ?? 'skip';
  if (blockDeleteMode !== 'skip' && blockDeleteMode !== 'execute') {
    issue('INVALID_OPTION', 0, 'blockDelete must be "skip" or "execute"');
  }
  let startPos: GcodePoint = { x: 0, y: 0, z: 0 };
  if (options.initialPosition !== undefined) {
    if (finitePoint(options.initialPosition)) startPos = { ...options.initialPosition };
    else issue('INVALID_OPTION', 0, 'initialPosition must have finite x, y and z');
  }
  const extraM = new Set<number>();
  for (const m of options.extraMCodes ?? []) {
    if (Number.isInteger(m) && m >= 0) extraM.add(m);
    else issue('INVALID_OPTION', 0, `extraMCodes entry ${String(m)} is not a non-negative integer`);
  }
  const keepLines = options.snapshots ?? true;

  const st = initialState(startPos, arcDefault === 'G90.1' ? 'G90.1' : 'G91.1');
  const moves: GcodeMove[] = [];
  const events: GcodeEvent[] = [];
  const lines: GcodeLine[] = [];

  const lineEnding = detectLineEnding(text);
  const rawLines = text.split(/\r\n|\n|\r/);
  if (rawLines.length > 1 && rawLines[rawLines.length - 1] === '') rawLines.pop();

  let percentCount = 0;
  let afterEndMarker = false;
  let afterEndMarkerWarned = false;
  let afterEndWarned = false;
  let anyWords = false;
  let inchWarned = false;

  for (let idx = 0; idx < rawLines.length; idx++) {
    const lineNo = idx + 1;
    const lex = lexLine(rawLines[idx] ?? '');
    let skipped = false;
    let block: number | null = null;

    const record = (): void => {
      if (keepLines) {
        lines.push({ line: lineNo, block, comments: lex.comments, skipped, state: snapshot(st) });
      }
    };

    if (afterEndMarker) {
      if ((lex.words.length > 0 || lex.error) && !afterEndMarkerWarned) {
        issue('CONTENT_AFTER_END_MARKER', lineNo, 'Text after the closing "%" is ignored');
        afterEndMarkerWarned = true;
      }
      skipped = true;
      record();
      continue;
    }
    if (lex.percent) {
      percentCount++;
      if (percentCount >= 2) afterEndMarker = true;
    }
    if (lex.error) {
      issue(lex.error.code, lineNo, lex.error.message);
      skipped = true;
      record();
      continue;
    }
    if (lex.words.length === 0) {
      record();
      continue;
    }
    anyWords = true;
    if (lex.percent) {
      issue('IGNORED_WORD', lineNo, 'Words on a "%" marker line are ignored');
      skipped = true;
      record();
      continue;
    }
    if (st.ended) {
      if (!afterEndWarned) {
        issue('CODE_AFTER_END', lineNo, 'Code after M2/M30 is not executed');
        afterEndWarned = true;
      }
      skipped = true;
      record();
      continue;
    }
    if (lex.blockDelete) {
      issue(
        'BLOCK_DELETE',
        lineNo,
        blockDeleteMode === 'execute'
          ? 'Block delete "/" line executed (depends on the controller switch)'
          : 'Block delete "/" line skipped (depends on the controller switch)',
      );
      if (blockDeleteMode !== 'execute') {
        skipped = true;
        record();
        continue;
      }
    }

    // ---- classify the words of the block --------------------------------------------------
    const val = new Map<string, Word>();
    const gCodes: number[] = [];
    const mCodes: number[] = [];
    let bad = false;
    const fail = (code: GcodeIssueCode, message: string): void => {
      issue(code, lineNo, message);
      bad = true;
    };
    // Strict (default): a word the reader does not model is an error and the line is not run.
    const unknown = (what: string): void => {
      if (strict !== false)
        fail('UNKNOWN_WORD', `${what} is not modelled by the reader (strict mode)`);
      else issue('UNKNOWN_WORD', lineNo, `${what} ignored (strict: false)`);
    };
    const gGroups = new Map<string, number>();
    const mGroups = new Map<string, number>();

    lex.words.forEach((w, wi) => {
      if (w.letter === 'G') {
        const key = Math.round(w.value * 10);
        if (Math.abs(w.value * 10 - key) > 1e-6 || w.value < 0) {
          fail('UNSUPPORTED_CODE', `${w.raw} is not a supported G code`);
          return;
        }
        if (key === 180 || key === 190) {
          fail('UNSUPPORTED_PLANE', `${w.raw}: only plane G17 (XY) is supported`);
          return;
        }
        const unsupported = G_UNSUPPORTED[key];
        if (unsupported) {
          fail('UNSUPPORTED_CODE', `${unsupported} is not supported by the reader`);
          return;
        }
        const group = G_GROUP[key];
        if (group === undefined) {
          unknown(`Unknown G code ${w.raw}`);
          return;
        }
        const prev = gGroups.get(group);
        if (prev !== undefined && prev !== key) {
          fail('MODAL_GROUP_CONFLICT', `${w.raw} conflicts with another ${group} code in the line`);
          return;
        }
        gGroups.set(group, key);
        gCodes.push(key);
        return;
      }
      if (w.letter === 'M') {
        if (!Number.isInteger(w.value) || w.value < 0) {
          fail('UNSUPPORTED_CODE', `${w.raw} is not a supported M code`);
          return;
        }
        const code = w.value;
        const unsupported = M_UNSUPPORTED[code];
        if (unsupported) {
          fail('UNSUPPORTED_CODE', `${unsupported} is not supported by the reader`);
          return;
        }
        const group = M_GROUP[code] ?? (extraM.has(code) ? `extra${code}` : undefined);
        if (group === undefined) {
          unknown(`Unknown M code ${w.raw}`);
          return;
        }
        const prev = mGroups.get(group);
        if (prev !== undefined && prev !== code) {
          fail('MODAL_GROUP_CONFLICT', `${w.raw} conflicts with another ${group} code in the line`);
          return;
        }
        mGroups.set(group, code);
        if (!mCodes.includes(code)) mCodes.push(code);
        return;
      }
      if (!VALUE_LETTERS.has(w.letter)) {
        unknown(`Unknown word ${w.raw}`);
        return;
      }
      if (w.letter === 'N' && wi !== 0) {
        issue('LINE_NUMBER_POSITION', lineNo, `Line number ${w.raw} is not the first word`);
      }
      if (val.has(w.letter)) {
        fail('DUPLICATE_WORD', `${w.letter} appears more than once in the line`);
        return;
      }
      val.set(w.letter, w);
    });
    const n = val.get('N');
    if (n) block = n.value;
    if (mGroups.has('coolant') && mGroups.has('coolantOff')) {
      fail('MODAL_GROUP_CONFLICT', 'M9 together with M7/M8 in one line');
    }

    const has = (k: number): boolean => gCodes.includes(k);
    const dwell = has(40);
    const motionCode = gCodes.find((k) => k === 0 || k === 10 || k === 20 || k === 30);
    const axisWords = val.has('X') || val.has('Y') || val.has('Z');

    // Value checks (before any state change, so a bad line changes nothing).
    const f = val.get('F');
    if (f && !(f.value > 0)) fail('INVALID_VALUE', `Feed ${f.raw} must be positive`);
    const s = val.get('S');
    if (s && s.value < 0) fail('INVALID_VALUE', `Spindle speed ${s.raw} must not be negative`);
    const t = val.get('T');
    if (t && (!Number.isInteger(t.value) || t.value < 0)) {
      fail('INVALID_VALUE', `Tool ${t.raw} must be a non-negative integer`);
    }
    if (dwell) {
      const p = val.get('P');
      const x = val.get('X');
      if (p && x) fail('AXIS_WORD_CONFLICT', 'G4 with both P and X');
      else if (!p && !x) fail('INVALID_VALUE', 'G4 without a P or X dwell time');
      else if (((p ?? x)?.value ?? 0) < 0)
        fail('INVALID_VALUE', 'G4 dwell time must not be negative');
      if (val.has('Y') || val.has('Z') || val.has('I') || val.has('J') || val.has('R')) {
        fail('AXIS_WORD_CONFLICT', 'G4 cannot be combined with axis or arc words');
      }
      if (motionCode !== undefined) {
        fail('AXIS_WORD_CONFLICT', 'G4 cannot be combined with a motion code in one line');
      }
    }
    if (val.has('I') || val.has('J') || val.has('R')) {
      if (val.has('R') && (val.has('I') || val.has('J'))) {
        fail('ARC_INVALID', 'An arc cannot have both R and I/J');
      }
    }
    if (bad) {
      skipped = true;
      record();
      continue;
    }

    // ---- execute in RS-274 order --------------------------------------------------------
    // Units first, so every number of this line is read in the new units.
    if (has(200) || has(210)) {
      st.units = has(200) ? 'G20' : 'G21';
      st.explicit.units = true;
      if (has(200) && !inchWarned) {
        issue('INCH_UNITS', lineNo, 'G20 inch program: values converted to millimetres');
        inchWarned = true;
      }
    }
    const k = st.units === 'G20' ? INCH : 1;
    const moveIndex = (): number => moves.length;

    if (f) st.feed = f.value * k;
    if (s) {
      const changed = st.rpm !== s.value;
      st.rpm = s.value;
      if (changed && st.spindle !== 'off' && !mGroups.has('spindle')) {
        events.push({
          kind: 'spindle',
          state: st.spindle,
          rpm: st.rpm,
          line: lineNo,
          moveIndex: moveIndex(),
        });
      }
    }
    if (t) st.selectedTool = t.value;
    if (mCodes.includes(6)) {
      if (st.selectedTool === null) {
        issue('TOOL_CHANGE_WITHOUT_T', lineNo, 'M6 without a selected tool (no T word yet)');
      }
      st.tool = st.selectedTool;
      events.push({ kind: 'toolChange', tool: st.tool, line: lineNo, moveIndex: moveIndex() });
    }
    const spindleM = mGroups.get('spindle');
    if (spindleM !== undefined) {
      st.spindle = spindleM === 3 ? 'cw' : spindleM === 4 ? 'ccw' : 'off';
      events.push({
        kind: 'spindle',
        state: st.spindle,
        rpm: st.rpm,
        line: lineNo,
        moveIndex: moveIndex(),
      });
    }
    for (const m of mCodes) {
      if (m === 7 || m === 8 || m === 9) {
        if (m === 7) st.coolant.mist = true;
        else if (m === 8) st.coolant.flood = true;
        else st.coolant = { mist: false, flood: false };
        const state = m === 7 ? 'mist' : m === 8 ? 'flood' : 'off';
        events.push({ kind: 'coolant', state, line: lineNo, moveIndex: moveIndex() });
      } else if (extraM.has(m) && M_GROUP[m] === undefined) {
        events.push({ kind: 'mcode', code: m, line: lineNo, moveIndex: moveIndex() });
      }
    }
    if (has(170)) st.explicit.plane = true;
    if (has(900) || has(910)) {
      st.distance = has(900) ? 'G90' : 'G91';
      st.explicit.distance = true;
    }
    if (has(901) || has(911)) {
      st.arcDistance = has(901) ? 'G90.1' : 'G91.1';
      st.explicit.arcDistance = true;
    }
    const wcsKey = gCodes.find((g) => WCS[g] !== undefined);
    if (wcsKey !== undefined) {
      st.wcs = WCS[wcsKey] ?? 'G54';
      st.explicit.wcs = true;
    }

    if (dwell) {
      const p = val.get('P');
      const seconds = p
        ? dwellUnit === 'ms'
          ? p.value / 1000
          : p.value
        : (val.get('X')?.value ?? 0);
      events.push({ kind: 'dwell', seconds, line: lineNo, moveIndex: moveIndex() });
    } else {
      if (motionCode !== undefined) st.motion = MOTION[motionCode] ?? null;
      const arcWords = val.has('I') || val.has('J') || val.has('R');
      const isArcMode = st.motion === 'G2' || st.motion === 'G3';
      if (val.has('P')) issue('IGNORED_WORD', lineNo, 'P outside G4 ignored');
      if (val.has('K')) issue('IGNORED_WORD', lineNo, 'K ignored (plane G17)');
      if (axisWords || (arcWords && isArcMode)) {
        if (st.motion === null) {
          issue('NO_MOTION_MODE', lineNo, 'Axis words without a motion mode (G0/G1/G2/G3)');
          skipped = true;
        } else {
          if (arcWords && !isArcMode) {
            issue('IGNORED_WORD', lineNo, `I/J/R ignored on a ${st.motion} move`);
          }
          executeMotion(lineNo, block, val, k, f !== undefined);
        }
      } else if (arcWords) {
        issue('IGNORED_WORD', lineNo, 'I/J/R without an arc move ignored');
      }
    }

    for (const m of mCodes) {
      if (m === 0 || m === 1) {
        events.push({ kind: 'pause', optional: m === 1, line: lineNo, moveIndex: moveIndex() });
      } else if (m === 2 || m === 30) {
        st.ended = true;
        events.push({
          kind: 'end',
          code: m === 2 ? 'M2' : 'M30',
          line: lineNo,
          moveIndex: moveIndex(),
        });
      }
    }
    record();
  }

  function executeMotion(
    lineNo: number,
    block: number | null,
    val: Map<string, Word>,
    k: number,
    feedExplicit: boolean,
  ): void {
    const from = { ...st.position };
    const to = { ...st.position };
    const assumed = new Set<GcodeAxis>(st.assumedAxes);
    for (const axis of ['x', 'y', 'z'] as const) {
      const w = val.get(axis.toUpperCase());
      if (!w) continue;
      const v = w.value * k;
      if (st.distance === 'G90') {
        to[axis] = v;
        assumed.delete(axis);
      } else {
        if (assumed.has(axis)) {
          issue(
            'INCREMENTAL_FROM_UNKNOWN',
            lineNo,
            `Incremental ${axis.toUpperCase()} move from an unknown position`,
          );
        }
        to[axis] = st.position[axis] + v;
      }
    }
    const assumedAxes = (['x', 'y', 'z'] as const).filter((a) => assumed.has(a));
    const motion = st.motion;
    if (motion === null) return;
    const base = {
      from,
      to,
      spindleOn: st.spindle !== 'off',
      rpm: st.rpm,
      tool: st.tool,
      line: lineNo,
      block,
      assumedAxes,
    };

    const commit = (): void => {
      st.position = to;
      st.assumedAxes = assumedAxes;
    };

    if (motion === 'G0') {
      moves.push({ type: 'rapid', ...base, feed: null, feedExplicit });
      commit();
      return;
    }
    if (st.feed === null) {
      issue('FEED_UNDEFINED', lineNo, `${motion} move without a feed (no F yet)`);
      events.push({ kind: 'missingFeed', line: lineNo, moveIndex: moves.length });
    }
    if (motion === 'G1') {
      moves.push({ type: 'feed', ...base, feed: st.feed, feedExplicit });
      commit();
      return;
    }

    const direction = motion === 'G2' ? 'cw' : 'ccw';
    if (st.assumedAxes.includes('x') || st.assumedAxes.includes('y')) {
      issue('ARC_FROM_UNKNOWN_POSITION', lineNo, 'Arc starts from an unknown XY position');
      commit();
      return;
    }
    const r = val.get('R');
    let result: ArcResult;
    if (r) {
      result = arcFromRadius(from, to, r.value * k, direction, arcTol);
    } else {
      const i = (val.get('I')?.value ?? 0) * k;
      const j = (val.get('J')?.value ?? 0) * k;
      if (!val.has('I') && !val.has('J')) {
        issue('ARC_INVALID', lineNo, 'Arc without I/J or R');
        commit();
        return;
      }
      const cx = st.arcDistance === 'G90.1' ? i : from.x + i;
      const cy = st.arcDistance === 'G90.1' ? j : from.y + j;
      result = arcFromCentre(from, to, cx, cy, direction, arcTol);
    }
    if (!result.ok) {
      // The end point is still well defined: keep the position so later lines read correctly.
      issue(result.code, lineNo, result.message);
      commit();
      return;
    }
    moves.push({
      type: direction === 'cw' ? 'arcCw' : 'arcCcw',
      ...base,
      arc: result.arc,
      feed: st.feed,
      feedExplicit,
    });
    commit();
  }

  if (!anyWords) {
    issue('EMPTY_PROGRAM', 0, 'The program has no G-code words');
  } else if (!st.ended) {
    issue('NO_PROGRAM_END', 0, 'The program has no end code (M2/M30)');
  }

  return {
    ok: errors.length === 0,
    moves,
    events,
    lines,
    errors,
    warnings,
    lineEnding,
    finalState: snapshot(st),
  };
}

/** True when two points are equal within EPS on every axis. */
export function samePoint(a: GcodePoint, b: GcodePoint, tol = EPS): boolean {
  return Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.z - b.z) <= tol;
}
