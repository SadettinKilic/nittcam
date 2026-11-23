/**
 * The §7.2 rules (R1–R10) and the tool-change check (§6.5), judged on the read program
 * (T019, D-027). Every check works on what the reader found, in the sheet frame where heights
 * matter. Pure.
 */
import type { GcodeEvent, GcodeIssueCode, GcodeReadResult } from '../gcode-reader';
import { PROFILE_BOUNDS } from '../machine/profile';
import type { Operation } from '../toolpath';
import type { Derived } from './derive';
import { aboveTable, intoTable } from './frame';
import { arcExtremes, fmt, type SheetMove } from './path';
import type { GcodeCheckRule, GcodeCheckViolation } from './types';

export type Push = (
  rule: GcodeCheckRule,
  code: string,
  line: number,
  message: string,
  severity?: 'error' | 'warning',
) => void;

/** Float noise of the inverse frame (mm): the only slack of the Z limits. */
const Z_FLOAT_NOISE = 1e-9;

/** Rule 10 marker, compared after folding Turkish letters and case. */
const UNVERIFIED_MARKERS = ['DOGRULANMADI', 'AIR CUT'] as const;

export function foldText(s: string): string {
  return s
    .replace(/[ğĞ]/g, 'G')
    .replace(/[ıİ]/g, 'I')
    .replace(/[öÖ]/g, 'O')
    .replace(/[üÜ]/g, 'U')
    .replace(/[şŞ]/g, 'S')
    .replace(/[çÇ]/g, 'C')
    .toUpperCase();
}

/** Reader issue codes that are number-format problems (rule 8). */
const NUMBER_CODES: ReadonlySet<GcodeIssueCode> = new Set(['EXPONENT_NUMBER', 'INVALID_NUMBER']);

/** Reader warnings that block: the program's meaning depends on the operator or the controller. */
const BLOCKING_WARNINGS: ReadonlySet<GcodeIssueCode> = new Set([
  'BLOCK_DELETE',
  'PERCENT_MID_PROGRAM',
]);

/** Reader warnings judged by a rule below (not repeated as R9). */
const JUDGED_ELSEWHERE: ReadonlySet<GcodeIssueCode> = new Set([
  'FEED_UNDEFINED', // R5
  'SPINDLE_NO_RPM', // R4
  'INCH_UNITS', // R1
  'NO_PROGRAM_END', // R7
  'CODE_AFTER_END', // R7
  'TOOL_CHANGE_WITHOUT_T', // TOOLS
  'INCREMENTAL_FROM_UNKNOWN', // R2
]);

/** R8 + R9: the reader's own findings. */
export function readerFindings(read: GcodeReadResult, push: Push): void {
  for (const e of read.errors) {
    if (NUMBER_CODES.has(e.code)) {
      push('R8', 'NUMBER_FORMAT', e.line, `Number not in fixed decimal form: ${e.message}`);
    }
    push('R9', e.code, e.line, `Reader error: ${e.message}`);
  }
  for (const w of read.warnings) {
    if (JUDGED_ELSEWHERE.has(w.code)) continue;
    if (w.code === 'BOM_STRIPPED') continue;
    push(
      'R9',
      w.code,
      w.line,
      `Reader warning: ${w.message}`,
      BLOCKING_WARNINGS.has(w.code) ? 'error' : 'warning',
    );
  }
  if (read.warnings.some((w) => w.code === 'CODE_AFTER_END')) {
    const w = read.warnings.find((x) => x.code === 'CODE_AFTER_END');
    push('R7', 'CODE_AFTER_END', w?.line ?? 0, 'Code after the program end (M2/M30).');
  }
}

/** R10: the unverified header comment is the first line of the program. */
export function headerRule(text: string, d: Derived, push: Push): void {
  if (!d.unverified) return;
  const first = text
    .split(/\r\n|\r|\n/)
    .map((l, i) => ({ l: l.trim(), i }))
    .find(({ l }) => l !== '' && l !== '%');
  const isComment = first !== undefined && (first.l.startsWith('(') || first.l.startsWith(';'));
  const folded = first ? foldText(first.l) : '';
  if (!isComment || !UNVERIFIED_MARKERS.every((m) => folded.includes(m))) {
    push(
      'R10',
      'UNVERIFIED_HEADER_MISSING',
      first ? first.i + 1 : 0,
      'Unverified profile or post: the first line must be the comment "DOĞRULANMADI, önce air cut".',
    );
  }
}

/** R1: explicit modal state before the first motion, and it never changes to inch/incremental. */
export function modalRule(read: GcodeReadResult, d: Derived, push: Push): void {
  const first = read.moves[0];
  if (!first) {
    push('R1', 'NO_MOTION', 0, 'The program has no motion.');
    return;
  }
  const st = read.lines[first.line - 1]?.state;
  if (!st) return;
  const missing: string[] = [];
  if (!st.explicit.units) missing.push('units (G21)');
  if (!st.explicit.distance) missing.push('distance mode (G90)');
  if (!st.explicit.plane) missing.push('plane (G17)');
  if (!st.explicit.wcs) missing.push('work offset (G54–G59)');
  const word = d.ctx.post?.arcs?.distanceModeWord ?? null;
  // D-025 rule-1 exception: a post that declares no arc distance word (generic) relies on the
  // RS-274 default (incremental I/J); a post that declares one must write it.
  if (word !== null && (!st.explicit.arcDistance || st.arcDistance !== word)) {
    missing.push(`arc distance mode (${word})`);
  }
  if (missing.length > 0) {
    push(
      'R1',
      'MODAL_NOT_EXPLICIT',
      first.line,
      `Modal state not set before the first move: ${missing.join(', ')}.`,
    );
  }
  for (const m of read.moves) {
    const s = read.lines[m.line - 1]?.state;
    if (!s) continue;
    if (s.units !== 'G21' || s.distance !== 'G90' || (word !== null && s.arcDistance !== word)) {
      push(
        'R1',
        'MODAL_WRONG',
        m.line,
        `Move in ${s.units} ${s.distance} ${s.arcDistance}: the program must run in G21 G90${word ? ` ${word}` : ''}.`,
      );
      break;
    }
  }
}

interface MotionState {
  spindle: 'cw' | 'ccw' | 'off';
  dwell: number;
  vacuumOn: boolean;
  vacuumEverOn: boolean;
}

/**
 * R2–R7 in one walk over moves and events (events with `moveIndex = i` happen before move i).
 * Each code is reported once per program (the first occurrence).
 */
export function motionRules(
  read: GcodeReadResult,
  sm: readonly SheetMove[],
  d: Derived,
  push: Push,
): void {
  const { profile, stock } = d.ctx;
  const tol = d.posTol;
  const lim = d.limitTol;
  // Z limits: no rounding tolerance (the post rounds Z toward +Z, D-025); only float noise.
  const zLim = Z_FLOAT_NOISE;
  const warmup = profile.spindle.warmupSeconds;
  const toolRadius = Math.max(...d.ops.map((o) => o.toolDiameter / 2));
  const st: MotionState = { spindle: 'off', dwell: 0, vacuumOn: false, vacuumEverOn: false };
  const events = read.events;
  let ei = 0;
  let afterRapid = true;
  // After a tool change or pause the machine's Z is not known: safe Z is written again first.
  let needSafeZ: GcodeEvent | null = null;
  const posBefore = (i: number) => (i > 0 ? sm[i - 1] : undefined);

  const isVacuum = (e: GcodeEvent, which: 'on' | 'off'): boolean => {
    if (!d.vacuum) return false;
    const code = which === 'on' ? d.vacuum.on : d.vacuum.off;
    if (e.kind === 'mcode') return e.code === code;
    if (e.kind === 'coolant') {
      if (which === 'on')
        return (code === 7 && e.state === 'mist') || (code === 8 && e.state === 'flood');
      return code === 9 && e.state === 'off';
    }
    return false;
  };

  const event = (e: GcodeEvent): void => {
    const prev = posBefore(e.moveIndex);
    switch (e.kind) {
      case 'spindle':
        if (e.state === 'off') {
          st.spindle = 'off';
          return;
        }
        st.spindle = e.state;
        st.dwell = 0;
        if (e.state === 'ccw') {
          push(
            'R4',
            'SPINDLE_DIRECTION',
            e.line,
            'M4 (counter-clockwise): the toolpath assumes M3.',
          );
        }
        if (e.rpm === null || !(e.rpm > 0)) {
          push('R4', 'SPINDLE_NO_RPM', e.line, 'Spindle started without a spindle speed (S).');
        } else if (e.rpm < profile.spindle.minRpm || e.rpm > profile.spindle.maxRpm) {
          push(
            'R4',
            'SPINDLE_RPM_RANGE',
            e.line,
            `S${e.rpm} is outside the spindle range ${profile.spindle.minRpm}–${profile.spindle.maxRpm}.`,
          );
        }
        return;
      case 'dwell':
        st.dwell += e.seconds;
        return;
      case 'toolChange':
      case 'pause':
        needSafeZ = e;
        if (!prev || prev.toAssumed.includes('z') || prev.to.z < d.safeZ - tol) {
          push(
            'R2',
            'TOOL_CHANGE_BELOW_SAFE_Z',
            e.line,
            `${e.kind === 'pause' ? 'Pause (M0/M1)' : 'Tool change'} not at safe Z ${d.safeZ}.`,
          );
        }
        if (st.spindle !== 'off') {
          push(
            'TOOLS',
            'TOOL_CHANGE_SPINDLE_ON',
            e.line,
            'Tool change or pause with the spindle running.',
          );
        }
        return;
      case 'machineMove': {
        // T309 (D-097): a G53 move is only the profile's park point: G0, X and Y both given and
        // equal to the park, at safe Z, spindle off, and a pause follows before any move.
        const park = d.park;
        const pauseFollows = events.some(
          (x) => x.kind === 'pause' && x.moveIndex === e.moveIndex && x.line >= e.line,
        );
        const ok =
          park !== null &&
          e.motion === 'G0' &&
          e.x !== null &&
          e.y !== null &&
          Math.abs(e.x - park.x) <= tol &&
          Math.abs(e.y - park.y) <= tol &&
          prev !== undefined &&
          !prev.toAssumed.includes('z') &&
          prev.to.z >= d.safeZ - tol &&
          st.spindle === 'off' &&
          pauseFollows;
        if (!ok) {
          push(
            'R6',
            'MACHINE_MOVE',
            e.line,
            park === null
              ? 'G53 (machine coordinates) move, but the profile has no park point for this post.'
              : `G53 move is not the profile's park move (G0 X${park.x} Y${park.y} at safe Z, spindle off, then a pause).`,
          );
        }
        return;
      }
      case 'coolant':
      case 'mcode':
        if (isVacuum(e, 'on')) {
          st.vacuumOn = true;
          st.vacuumEverOn = true;
        } else if (isVacuum(e, 'off')) {
          st.vacuumOn = false;
        }
        return;
      default:
        return;
    }
  };

  const flush = (upTo: number) => {
    while (ei < events.length && (events[ei]?.moveIndex ?? Infinity) <= upTo) {
      const e = events[ei++];
      if (e) event(e);
    }
  };

  // Rule 6, static part: the sheet lies on the table.
  const f = d.frame;
  // Physical sheet edges relative to program zero, measured into the table.
  const xs = [f.intoX * f.sheetX, f.intoX * (f.sheetX + stock.sheetWidth)];
  const ys = [f.intoY * f.sheetY, f.intoY * (f.sheetY + stock.sheetHeight)];
  if (
    Math.min(...xs) < -lim ||
    Math.min(...ys) < -lim ||
    Math.max(...xs) > profile.table.width + lim ||
    Math.max(...ys) > profile.table.depth + lim
  ) {
    push(
      'R6',
      'SHEET_OUTSIDE_TABLE',
      0,
      `The sheet (${stock.sheetWidth} × ${stock.sheetHeight} at offset ${profile.origin.sheetOffset.x} / ${profile.origin.sheetOffset.y}) does not fit the table ${profile.table.width} × ${profile.table.depth}.`,
    );
  }

  const envelope = (x: number, y: number, z: number, line: number) => {
    const into = intoTable(f, x, y);
    if (into.x < -lim || into.x > profile.workEnvelope.x + lim) {
      push(
        'R6',
        'OUT_OF_ENVELOPE',
        line,
        `X ${x} is ${into.x.toFixed(4)} mm from program zero, travel 0–${profile.workEnvelope.x}.`,
      );
    }
    if (into.y < -lim || into.y > profile.workEnvelope.y + lim) {
      push(
        'R6',
        'OUT_OF_ENVELOPE',
        line,
        `Y ${y} is ${into.y.toFixed(4)} mm from program zero, travel 0–${profile.workEnvelope.y}.`,
      );
    }
    const h = aboveTable(f, z, stock.thickness);
    if (h < -profile.zZero.spoilboardAllowance - zLim) {
      push(
        'R6',
        'BELOW_SPOILBOARD_ALLOWANCE',
        line,
        `Z ${z} is ${(-h).toFixed(4)} mm below the table surface, allowance ${profile.zZero.spoilboardAllowance}.`,
      );
    }
    if (h > profile.workEnvelope.z + zLim) {
      push(
        'R6',
        'OUT_OF_ENVELOPE',
        line,
        `Z ${z} is ${h.toFixed(4)} mm above the table, Z travel ${profile.workEnvelope.z}.`,
      );
    }
  };

  // T323, T330 (D-121): the machine's feed ceiling, derived here from the profile on its own (not
  // from the generator): the own maximum when set, otherwise the rapid rate (half of it for the
  // plunge), never below the highest feed of the profile's material sets.
  const rapid = profile.rapidFeed ?? 10_000;
  const feedCap = {
    feed: Math.min(
      profile.maxFeed ?? Math.max(rapid, ...profile.materials.map((m) => m.feed)),
      PROFILE_BOUNDS.feed.max,
    ),
    plunge: Math.min(
      profile.maxPlungeFeed ?? Math.max(rapid / 2, ...profile.materials.map((m) => m.plungeFeed)),
      PROFILE_BOUNDS.plungeFeed.max,
    ),
  };
  const plungeLimit = (tool: number | null): number => {
    const ops = d.ops.filter((o) => tool === null || o.tool === tool);
    return Math.max(...(ops.length > 0 ? ops : d.ops).map((o) => o.plungeFeed));
  };

  sm.forEach((m, i) => {
    flush(i);
    const raw = m.raw;
    // --- R2: first move, XY rapids at safe Z, no feed from an unknown position ---
    if (i === 0) {
      const zOnly = m.toAssumed.includes('x') && m.toAssumed.includes('y');
      if (m.kind !== 'rapid' || !zOnly || m.toAssumed.includes('z') || m.to.z < d.safeZ - tol) {
        push(
          'R2',
          'FIRST_MOVE_NOT_SAFE_Z',
          m.line,
          `The first move must be a Z-only rapid up to safe Z ${d.safeZ}.`,
        );
      }
    }
    if (needSafeZ) {
      const zOnlyUp =
        m.kind === 'rapid' &&
        Math.abs(m.to.x - m.from.x) <= tol &&
        Math.abs(m.to.y - m.from.y) <= tol &&
        m.to.z >= d.safeZ - tol;
      if (!zOnlyUp) {
        push(
          'R2',
          'NO_SAFE_Z_AFTER_TOOL_CHANGE',
          m.line,
          `The first move after the ${needSafeZ.kind === 'pause' ? 'pause' : 'tool change'} on line ${needSafeZ.line} must be a Z-only rapid to safe Z ${d.safeZ}.`,
        );
      }
      needSafeZ = null;
    }
    const xyChange =
      m.fromAssumed.includes('x') !== m.toAssumed.includes('x') ||
      m.fromAssumed.includes('y') !== m.toAssumed.includes('y') ||
      Math.abs(m.to.x - m.from.x) > tol ||
      Math.abs(m.to.y - m.from.y) > tol;
    if (m.kind === 'rapid') {
      if (
        xyChange &&
        (m.fromAssumed.includes('z') || m.from.z < d.safeZ - tol || m.to.z < d.safeZ - tol)
      ) {
        push(
          'R2',
          'XY_RAPID_BELOW_SAFE_Z',
          m.line,
          `XY rapid from ${fmt(m.from)} to ${fmt(m.to)} below safe Z ${d.safeZ}.`,
        );
      }
      // --- R3: no rapid ends below the clearance plane (a straight retract upwards is fine) ---
      const retract = !xyChange && m.to.z > m.from.z + tol;
      if (!retract && m.to.z < d.clearanceZ - tol) {
        if (m.to.z <= tol) {
          push(
            'R3',
            'RAPID_INTO_MATERIAL',
            m.line,
            `Rapid ends at Z ${m.to.z.toFixed(4)} (sheet frame), inside the material.`,
          );
        } else {
          push(
            'R3',
            'RAPID_BELOW_CLEARANCE',
            m.line,
            `Rapid ends at Z ${m.to.z.toFixed(4)}, below the clearance plane ${d.clearanceZ}.`,
          );
        }
      }
      afterRapid = true;
    } else {
      if (m.fromAssumed.length > 0 || m.toAssumed.length > 0) {
        push(
          'R2',
          'FEED_FROM_UNKNOWN_POSITION',
          m.line,
          'Cutting move from a position the program never set.',
        );
      }
      // --- R3: descending into the material at the plunge feed ---
      if (m.to.z < m.from.z - tol && m.to.z < -tol && raw.feed !== null) {
        const limit = plungeLimit(raw.tool);
        if (raw.feed > limit + d.feedTol) {
          push(
            'R3',
            'PLUNGE_TOO_FAST',
            m.line,
            `Descending move at F${raw.feed}, plunge feed is ${limit}.`,
          );
        }
      }
      // --- R4: spindle on, in range, warmed up; hold-down on ---
      if (!raw.spindleOn || st.spindle === 'off') {
        push('R4', 'CUT_SPINDLE_OFF', m.line, 'Cutting move with the spindle off.');
      } else if (st.dwell < warmup - 1e-9) {
        push(
          'R4',
          'WARMUP_MISSING',
          m.line,
          `Cutting move after ${st.dwell} s dwell, warm-up is ${warmup} s.`,
        );
      }
      if (d.vacuum && !st.vacuumOn) {
        push(
          'R4',
          'VACUUM_NOT_ON',
          m.line,
          `Cutting move without the vacuum on (M${d.vacuum.on}).`,
        );
      }
      // --- R5: explicit F on the first cut after a rapid; never an undefined feed ---
      if (raw.feed === null) {
        push('R5', 'FEED_UNDEFINED', m.line, 'Cutting move with no feed defined.');
      } else if (afterRapid && !raw.feedExplicit) {
        push(
          'R5',
          'FEED_NOT_EXPLICIT',
          m.line,
          'The first cutting move after a rapid must state its feed (F).',
        );
      }
      // --- R5 (T323): no feed above what the machine can run ---
      if (raw.feed !== null) {
        const down = m.to.z < m.from.z - tol && m.to.z < -tol;
        const cap = down ? feedCap.plunge : feedCap.feed;
        if (raw.feed > cap + d.feedTol) {
          push(
            'R5',
            'FEED_ABOVE_MACHINE',
            m.line,
            `F${raw.feed} is above the machine's ${down ? 'plunge' : 'cutting'} feed limit ${cap}.`,
          );
        }
      }
      afterRapid = false;
    }
    // --- R6: envelope (end points and arc extremes), spoilboard depth, sheet limits for cuts ---
    envelope(raw.to.x, raw.to.y, raw.to.z, m.line);
    if (raw.arc) {
      const zLow = Math.min(raw.from.z, raw.to.z);
      for (const p of arcExtremes(raw.from, {
        cx: raw.arc.cx,
        cy: raw.arc.cy,
        r: raw.arc.radius,
        sweep: raw.arc.sweep,
        dir: raw.arc.direction,
      })) {
        envelope(p.x, p.y, zLow, m.line);
      }
    }
    if (m.kind !== 'rapid' && Math.min(m.from.z, m.to.z) < -tol) {
      const pts = [m.to, ...(m.arc ? arcExtremes(m.from, m.arc) : [])];
      const r = toolRadius + tol;
      if (
        pts.some(
          (p) => p.x < -r || p.y < -r || p.x > stock.sheetWidth + r || p.y > stock.sheetHeight + r,
        )
      ) {
        push(
          'R6',
          'CUT_OUTSIDE_SHEET',
          m.line,
          `Cutting move to ${fmt(m.to)} leaves the sheet (plus the tool radius).`,
        );
      } else {
        // T331 (field rehearsal B2): the whole cutter stays on the sheet below the material top:
        // the centre keeps the active tool's radius from every sheet edge (a stop, fence or clamp
        // at the edge is hit otherwise). The radius is the program's own tool, read here.
        const own = d.ops.find((o) => o.tool === raw.tool)?.toolDiameter;
        const rr = (own ?? 0) / 2 - tol;
        const off = pts.find(
          (p) =>
            p.x < rr || p.y < rr || p.x > stock.sheetWidth - rr || p.y > stock.sheetHeight - rr,
        );
        if (rr > 0 && off) {
          push(
            'R6',
            'CUTTER_OFF_SHEET',
            m.line,
            `Cutting move to ${fmt(m.to)}: the Ø${own} cutter reaches past the sheet edge at X${off.x.toFixed(4)} Y${off.y.toFixed(4)}.`,
          );
        }
      }
    }
  });
  flush(Number.POSITIVE_INFINITY);

  // --- R7: end sequence ---
  const last = sm[sm.length - 1];
  if (last && (last.toAssumed.includes('z') || last.to.z < d.safeZ - tol)) {
    push(
      'R7',
      'END_NOT_AT_SAFE_Z',
      last.line,
      `The program ends at Z ${last.to.z.toFixed(4)}, not at safe Z ${d.safeZ}.`,
    );
  }
  if (read.finalState.spindle !== 'off' || st.spindle !== 'off') {
    push('R7', 'END_SPINDLE_ON', 0, 'The spindle is not switched off at the end (M5).');
  }
  if (st.vacuumOn) {
    push(
      'R7',
      'END_VACUUM_ON',
      0,
      `The vacuum is not switched off at the end (M${d.vacuum?.off ?? '?'}).`,
    );
  }
  const end = events.find((e) => e.kind === 'end');
  if (!end || !read.finalState.ended) {
    push('R7', 'END_CODE_MISSING', 0, 'No program end code (M30/M2).');
  } else if (end.moveIndex < sm.length) {
    push('R7', 'END_BEFORE_LAST_MOVE', end.line, 'Program end before the last move.');
  }
}

/** Expected tool runs of a list of operations (consecutive equal tools merged). */
export function toolRuns(ops: readonly Operation[]): number[] {
  const out: number[] = [];
  for (const op of ops) if (out[out.length - 1] !== op.tool) out.push(op.tool);
  return out;
}

/** Comments that belong to a line: its own and the comment-only lines right above it. */
function promptComments(
  read: GcodeReadResult,
  rawLines: readonly string[],
  line: number,
): string[] {
  const out: string[] = [...(read.lines[line - 1]?.comments ?? [])];
  for (let i = line - 2; i >= 0 && i >= line - 6; i--) {
    const text = (rawLines[i] ?? '')
      .replace(/\([^)]*\)/g, '')
      .replace(/;.*$/, '')
      .trim();
    if (text !== '' && text !== '%') break;
    out.push(...(read.lines[i]?.comments ?? []));
  }
  return out;
}

/** TOOLS: tool-change order and numbers against the model; every tool in the profile. */
export function toolRules(
  read: GcodeReadResult,
  rawLines: readonly string[],
  ops: readonly Operation[],
  d: Derived,
  push: Push,
): void {
  const { profile } = d.ctx;
  const known = new Set(profile.tools.map((t) => t.number));
  const runs = toolRuns(ops);
  for (const t of runs) {
    if (!known.has(t))
      push('TOOLS', 'TOOL_NOT_IN_PROFILE', 0, `Model tool T${t} is not in the machine profile.`);
  }
  const changes = read.events.filter((e) => e.kind === 'toolChange');
  for (const c of changes) {
    if (c.tool === null)
      push('TOOLS', 'TOOL_CHANGE_WITHOUT_T', c.line, 'M6 without a tool number.');
    else if (!known.has(c.tool)) {
      push('TOOLS', 'TOOL_NOT_IN_PROFILE', c.line, `T${c.tool} is not in the machine profile.`);
    }
  }
  if (changes.length > 0 && profile.toolChanger.type !== 'auto') {
    push(
      'TOOLS',
      'M6_WITHOUT_CHANGER',
      changes[0]?.line ?? 0,
      `M6 on a machine whose tool changer is ${profile.toolChanger.type}.`,
    );
  }
  if (d.toolMode === 'auto') {
    const seq = changes.map((c) => c.tool);
    const n = Math.max(seq.length, runs.length);
    for (let i = 0; i < n; i++) {
      if (seq[i] !== runs[i]) {
        push(
          'TOOLS',
          'TOOL_ORDER',
          changes[i]?.line ?? 0,
          `Tool change ${i + 1}: expected ${runs[i] === undefined ? 'none' : `T${runs[i]}`}, read ${seq[i] === undefined ? 'none' : `T${String(seq[i])}`} (model order ${runs.map((t) => `T${t}`).join(', ')}).`,
        );
        break;
      }
    }
  } else if (d.toolMode === 'manual') {
    const pauses = read.events.filter((e) => e.kind === 'pause');
    // T311 (D-100): a manual change (and the first-tool check) must stop with M0. M1 is an
    // optional stop: with optional stop off the controller runs on with the old tool.
    for (const p of pauses) {
      if (p.optional) {
        push(
          'TOOLS',
          'TOOL_CHANGE_OPTIONAL_STOP',
          p.line,
          'Manual tool change stops with M1 (optional stop): the controller may skip it. Use M0.',
        );
      }
    }
    const first = d.ctx.post?.toolChange?.pauseForFirstTool;
    const counts =
      first === undefined ? [runs.length - 1, runs.length] : [runs.length - 1 + (first ? 1 : 0)];
    if (!counts.includes(pauses.length)) {
      push(
        'TOOLS',
        'TOOL_PAUSE_COUNT',
        pauses[0]?.line ?? 0,
        `Expected ${counts.join(' or ')} tool-change pauses (M0/M1), read ${pauses.length}.`,
      );
      return;
    }
    const offset = pauses.length === runs.length ? 0 : 1;
    pauses.forEach((p, i) => {
      const want = runs[i + offset];
      const named = new Set<number>();
      for (const c of promptComments(read, rawLines, p.line)) {
        for (const m of c.matchAll(/\bT(\d+)\b/g)) named.add(Number(m[1]));
      }
      if (want === undefined || named.size !== 1 || !named.has(want)) {
        push(
          'TOOLS',
          'TOOL_PROMPT_MISMATCH',
          p.line,
          `Tool-change pause ${i + 1} must name T${String(want)} to the operator, names ${named.size === 0 ? 'no tool' : [...named].map((t) => `T${t}`).join(', ')}.`,
        );
      }
      for (const t of named) {
        if (!known.has(t))
          push('TOOLS', 'TOOL_NOT_IN_PROFILE', p.line, `T${t} is not in the machine profile.`);
      }
    });
  } else if (runs.length > 1) {
    push(
      'TOOLS',
      'TOOL_RUNS_IN_ONE_FILE',
      0,
      `A "none" tool-change post needs one file per tool, this file has ${runs.length} tools.`,
    );
  }
}

export type { GcodeCheckViolation };

/**
 * Air-cut floor (D-031): when the context sets `zFloor`, no move of the program may reach below it
 * (sheet frame, 0 = material top). Every read move counts: rapids, leads, passes, tool-change and
 * end-park moves. A move made before the program set Z has an unknown height: also refused.
 */
export function floorRule(sm: readonly SheetMove[], d: Derived, push: Push): void {
  const floor = d.ctx.zFloor;
  if (floor === undefined) return;
  for (const m of sm) {
    if (m.toAssumed.includes('z')) {
      push(
        'R3',
        'AIR_CUT_BELOW_FLOOR',
        m.line,
        `Move before any Z was set; the air cut must stay at Z >= ${floor} above the material top.`,
      );
      return;
    }
    if (m.to.z < floor - Z_FLOAT_NOISE) {
      push(
        'R3',
        'AIR_CUT_BELOW_FLOOR',
        m.line,
        `Move reaches Z ${m.to.z.toFixed(4)} (sheet frame), below the air-cut floor ${floor}.`,
      );
      return;
    }
  }
}
/**
 * T324 (spec §7.2 rule 3, §6.3 "Dalma düz veya rampalı"): ramps stay inside the declared envelope.
 * A ramp is a feed move that goes down inside the material while it travels in XY (a contour ramp
 * or a hole helix). It is accepted only when every point of it lies on the XY trace of the level
 * cuts inside the material of the same block (the moves between two rapids that do not go down):
 * the kerf the program cuts there anyway. So a ramp never leaves the cut line of its contour,
 * never cuts into a neighbour, a tab bridge or the waste beside a lead. Independent of the
 * generator: judged on the read path only.
 */
export function rampRule(sm: readonly SheetMove[], d: Derived, push: Push): void {
  const tol = d.posTol;
  const reach = tol + (d.ctx.post?.arcs?.chordTolerance ?? RAMP_CHORD_TOLERANCE);
  // Sample spacing along a ramp: at most min(1 mm, smallest tool radius), so no stretch of a ramp
  // over uncut material can hide between two points (a fixed point count could, tester B59).
  const radii = d.ops.map((o) => o.toolDiameter / 2).filter((r) => r > 0);
  const spacing = Math.min(RAMP_SAMPLE_MAX_SPACING, ...radii);
  const xyLen = (m: SheetMove): number =>
    m.arc ? m.arc.r * m.arc.sweep : Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y);
  const isRamp = (m: SheetMove): boolean =>
    m.kind !== 'rapid' && m.to.z < m.from.z - tol && m.to.z < -tol && xyLen(m) > tol;
  let reported = 0;
  let i = 0;
  while (i < sm.length && reported < 5) {
    // One block: the feed moves between two rapids.
    let end = i;
    while (end < sm.length && (sm[end] as SheetMove).kind !== 'rapid') end++;
    const block = sm.slice(i, end);
    i = end + 1;
    const ramps = block.filter(isRamp);
    if (ramps.length === 0) continue;
    const trace = block.filter(
      (t) =>
        !isRamp(t) &&
        t.to.z <= t.from.z + tol &&
        t.to.z < -tol &&
        t.from.z < -tol &&
        xyLen(t) > tol,
    );
    for (const m of ramps) {
      const off = samples(m, spacing).find((p) => !trace.some((t) => distToMove(p, t) <= reach));
      if (!off) continue;
      reported++;
      push(
        'R3',
        'RAMP_OUTSIDE_KERF',
        m.line,
        `Ramp leaves the cut it enters: (${off.x.toFixed(3)}, ${off.y.toFixed(3)}) is not on a level cut of the same block.`,
      );
      if (reported >= 5) break;
    }
  }
}

/** Chord tolerance when the post writes arcs as lines (as the model match uses). */
const RAMP_CHORD_TOLERANCE = 0.01;

type XY = { x: number; y: number };

/** Largest gap between two checked points of a ramp, mm. */
const RAMP_SAMPLE_MAX_SPACING = 1;

/** Points along a read move, at most `spacing` mm apart, ends included (arcs by angle). */
function samples(m: SheetMove, spacing: number): XY[] {
  const out: XY[] = [];
  const len = m.arc ? m.arc.r * m.arc.sweep : Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y);
  const n = Math.max(1, Math.ceil(len / spacing));
  if (m.arc) {
    const a = m.arc;
    const a0 = Math.atan2(m.from.y - a.cy, m.from.x - a.cx);
    const s = a.dir === 'ccw' ? 1 : -1;
    for (let k = 0; k <= n; k++) {
      const ang = a0 + (s * a.sweep * k) / n;
      out.push({ x: a.cx + a.r * Math.cos(ang), y: a.cy + a.r * Math.sin(ang) });
    }
    return out;
  }
  for (let k = 0; k <= n; k++) {
    out.push({
      x: m.from.x + ((m.to.x - m.from.x) * k) / n,
      y: m.from.y + ((m.to.y - m.from.y) * k) / n,
    });
  }
  return out;
}

/** XY distance from `p` to a read move (segment or arc). */
function distToMove(p: XY, m: SheetMove): number {
  if (m.arc) {
    const a = m.arc;
    const a0 = Math.atan2(m.from.y - a.cy, m.from.x - a.cx);
    const ap = Math.atan2(p.y - a.cy, p.x - a.cx);
    const twoPi = 2 * Math.PI;
    let t = a.dir === 'ccw' ? ap - a0 : a0 - ap;
    t = ((t % twoPi) + twoPi) % twoPi;
    if (t <= a.sweep + 1e-12 || a.sweep >= twoPi - 1e-12) {
      return Math.abs(Math.hypot(p.x - a.cx, p.y - a.cy) - a.r);
    }
    return Math.min(
      Math.hypot(p.x - m.from.x, p.y - m.from.y),
      Math.hypot(p.x - m.to.x, p.y - m.to.y),
    );
  }
  const dx = m.to.x - m.from.x;
  const dy = m.to.y - m.from.y;
  const l2 = dx * dx + dy * dy;
  const u =
    l2 > 0 ? Math.max(0, Math.min(1, ((p.x - m.from.x) * dx + (p.y - m.from.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (m.from.x + u * dx), p.y - (m.from.y + u * dy));
}
