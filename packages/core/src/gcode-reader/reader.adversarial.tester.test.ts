/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known results */
/**
 * Tester review of the independent G-code reader (T018, D-026; spec §6.5, §7.2).
 * Adversarial input must give a precise error or warning, never throw and never produce a
 * non-finite number; strict vs non-strict on a realistic Mach3 file; performance.
 * Imports only the reader itself (the folder's independence scan allows nothing else).
 */
import { describe, expect, it } from 'vitest';
import { readGcode } from './reader';
import type { GcodeReadOptions, GcodeReadResult } from './types';

/** Timing budgets apply as written in CI; local runs on a loaded PC get PERF_BUDGET_SCALE (default 3, D-048). */
const BUDGET = process.env.CI ? 1 : Number(process.env.PERF_BUDGET_SCALE ?? 3);

/** Explicit modal setup, spindle on, a known start point and a defined feed. */
const PRE = 'G21 G90 G17 G54\nG0 Z20\nM3 S18000\nG1 X0 Y0 F100\n';
/** Same without the first feed move, for tests that need an undefined position or feed. */
const SETUP = 'G21 G90 G17 G54\nG0 Z20\nM3 S18000\n';

const codes = (r: GcodeReadResult) => r.errors.map((e) => e.code);
const wcodes = (r: GcodeReadResult) => r.warnings.map((e) => e.code);

/** Every number the result exposes is finite (null is allowed where the type says so). */
function expectFinite(r: GcodeReadResult): void {
  const walk = (v: unknown, path: string): void => {
    if (typeof v === 'number') {
      expect(Number.isFinite(v), `${path} = ${v}`).toBe(true);
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}[${i}]`));
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    }
  };
  walk(r.moves, 'moves');
  walk(r.events, 'events');
  walk(r.finalState, 'finalState');
}

function read(text: string, options?: GcodeReadOptions): GcodeReadResult {
  let r: GcodeReadResult | undefined;
  expect(() => {
    r = readGcode(text, options);
  }).not.toThrow();
  expectFinite(r!);
  expect(r!.ok).toBe(r!.errors.length === 0);
  return r!;
}

describe('adversarial numbers: a malformed number is an error and the line is not executed', () => {
  it.each([
    ['G1X1E5 F100', 'EXPONENT_NUMBER'],
    ['G1 X1e3 F100', 'EXPONENT_NUMBER'],
    ['G1 X1.5E-2 F100', 'EXPONENT_NUMBER'],
    ['G1 X--1 F100', 'INVALID_NUMBER'],
    ['G1 X. F100', 'INVALID_NUMBER'],
    ['G1 X- F100', 'INVALID_NUMBER'],
    ['G1 X1.2.3 F100', 'INVALID_NUMBER'],
    ['G1 XNaN F100', 'INVALID_NUMBER'],
    ['G1 XInf F100', 'INVALID_NUMBER'],
    ['G1 X#1 F100', 'INVALID_NUMBER'],
    ['G1 X1 F1e', 'INVALID_NUMBER'],
    [`G1 X${'9'.repeat(400)} F100`, 'INVALID_NUMBER'],
    [`G1 X1 F${'9'.repeat(400)}`, 'INVALID_NUMBER'],
    [`S${'9'.repeat(400)}`, 'INVALID_NUMBER'],
    [`G1 X1 N${'9'.repeat(400)}`, 'INVALID_NUMBER'],
  ])('%#: %s -> %s', (line, code) => {
    const r = read(PRE + line.replace(/^(.{0,60}).*$/s, (m) => m));
    expect(codes(r)).toContain(code);
    expect(r.ok).toBe(false);
    // the bad line moved nothing: only the two setup moves exist
    expect(r.moves).toHaveLength(2);
    expect(r.moves[1]!.to).toEqual({ x: 0, y: 0, z: 20 });
    expect(r.lines[r.lines.length - 1]!.skipped).toBe(true);
  });

  it('accepted odd-but-valid spellings read to the exact value', () => {
    const r = read(PRE + 'G1 X-.5 Y+.25 Z5. F+200\nG1 X-0');
    expect(r.errors).toEqual([]);
    expect(r.moves[2]!.to).toEqual({ x: -0.5, y: 0.25, z: 5 });
    expect(r.moves[2]!.feed).toBe(200);
    expect(Object.is(r.moves[3]!.to.x, -0)).toBe(false); // no negative zero leaks out
  });

  it('a 400-decimal fraction is a finite number (rounds to 0), not NaN', () => {
    const r = read(PRE + `G1 X0.${'0'.repeat(400)}1`);
    expect(r.errors).toEqual([]);
    expect(r.moves[2]!.to.x).toBe(0);
  });
});

describe('adversarial arcs', () => {
  it('G2 without I/J/R is ARC_INVALID and does not move', () => {
    const r = read(PRE + 'G2 X10 Y0');
    expect(codes(r)).toContain('ARC_INVALID');
    expect(r.moves.some((m) => m.arc)).toBe(false);
  });

  it('G2 R0 is ARC_INVALID', () => {
    expect(codes(read(PRE + 'G2 X10 Y0 R0'))).toContain('ARC_INVALID');
  });

  it('R and I/J together are ARC_INVALID', () => {
    expect(codes(read(PRE + 'G2 X10 Y0 R5 I5 J0'))).toContain('ARC_INVALID');
  });

  it('start = end with I/J = 0 (zero radius) is ARC_INVALID', () => {
    expect(codes(read(PRE + 'G2 X10 Y0 I0 J0'))).toContain('ARC_INVALID');
    expect(codes(read(PRE + 'G2 X0 Y0 I0 J0'))).toContain('ARC_INVALID');
  });

  it('start = end without I/J is ARC_INVALID', () => {
    expect(codes(read(PRE + 'G2 X0 Y0'))).toContain('ARC_INVALID');
  });

  it('a full circle with R is ARC_INVALID; with I/J it is a 2π sweep', () => {
    expect(codes(read(PRE + 'G2 X0 Y0 R5'))).toContain('ARC_INVALID');
    const ok = read(PRE + 'G2 X0 Y0 I5 J0');
    expect(ok.errors).toEqual([]);
    expect(ok.moves[2]!.arc!.sweep).toBeCloseTo(2 * Math.PI, 12);
  });

  it('R sign: R>0 is the minor arc, R<0 the major arc, centre on the correct side', () => {
    const minor = read(PRE + 'G2 X10 Y0 R6').moves[2]!.arc!;
    const major = read(PRE + 'G2 X10 Y0 R-6').moves[2]!.arc!;
    const h = Math.sqrt(36 - 25);
    expect(minor.sweep).toBeCloseTo(2 * Math.asin(5 / 6), 9);
    expect(major.sweep).toBeCloseTo(2 * Math.PI - 2 * Math.asin(5 / 6), 9);
    // G2 (clockwise) from (0,0) to (10,0), minor arc bulges up, so the centre is below the chord
    expect(minor.cx).toBeCloseTo(5, 9);
    expect(minor.cy).toBeCloseTo(-h, 9);
    expect(major.cy).toBeCloseTo(h, 9);
    // G3 mirrors it
    const g3 = read(PRE + 'G3 X10 Y0 R6').moves[2]!.arc!;
    expect(g3.cy).toBeCloseTo(h, 9);
    expect(g3.sweep).toBeCloseTo(minor.sweep, 9);
    // the R form agrees with the equivalent I/J form (centre and sweep)
    const ij = read(PRE + `G2 X10 Y0 I5 J${-h}`).moves[2]!.arc!;
    expect(ij.cx).toBeCloseTo(minor.cx, 9);
    expect(ij.cy).toBeCloseTo(minor.cy, 9);
    expect(ij.sweep).toBeCloseTo(minor.sweep, 9);
  });

  it('a semicircle with R is a half circle for either sign (no hidden wrong-side arc)', () => {
    for (const rr of ['R5', 'R-5']) {
      const a = read(PRE + `G2 X10 Y0 ${rr}`).moves[2]!.arc!;
      expect(a.sweep).toBeCloseTo(Math.PI, 9);
      expect(a.cx).toBeCloseTo(5, 9);
      expect(a.cy).toBeCloseTo(0, 9);
    }
  });

  it('R smaller than half the chord is ARC_INVALID; 0.005 mm over is tolerated as a half circle', () => {
    expect(codes(read(PRE + 'G2 X10 Y0 R4'))).toContain('ARC_INVALID');
    const r = read(PRE + 'G2 X10.005 Y0 R5');
    expect(r.errors).toEqual([]);
    expect(r.moves[2]!.arc!.sweep).toBeCloseTo(Math.PI, 6);
  });

  it('radius mismatch > 0.01 mm is an error, <= 0.01 mm is accepted', () => {
    expect(codes(read(PRE + 'G2 X10 Y0 I5.02 J0'))).toContain('ARC_RADIUS_MISMATCH');
    expect(read(PRE + 'G2 X10 Y0 I5.004 J0').errors).toEqual([]);
  });

  it('an arc from an assumed (never set) XY position is an error', () => {
    const r = read(SETUP + 'G2 X10 Y0 I5 J0');
    expect(codes(r)).toContain('ARC_FROM_UNKNOWN_POSITION');
  });

  it('I/J in G90.1 (absolute) mode and the default G91.1 give the same centre', () => {
    const inc = read(PRE + 'G2 X10 Y0 I5 J0').moves[2]!.arc!;
    const abs = read(PRE + 'G90.1\nG2 X10 Y0 I5 J0').moves[2]!.arc!;
    expect(abs.cx).toBeCloseTo(5, 12);
    expect(inc.cx).toBeCloseTo(5, 12);
    const abs2 = read('G21 G90 G17 G54 G90.1\nG0 Z20\nG1 X3 Y4 F100\nG2 X3 Y-4 I0 J0.5').errors;
    // centre (0, 0.5) is not equidistant from (3,4) and (3,-4): must be flagged, not guessed
    expect(abs2.map((e) => e.code)).toContain('ARC_RADIUS_MISMATCH');
  });

  it('unmodelled planes are errors', () => {
    expect(codes(read(PRE + 'G18'))).toContain('UNSUPPORTED_PLANE');
    expect(codes(read(PRE + 'G19'))).toContain('UNSUPPORTED_PLANE');
  });
});

describe('unmodelled codes are errors (PO decision), not silently ignored', () => {
  it.each([
    'G28 Z0',
    'G41 D1',
    'G42 D1',
    'G43 H1 Z5',
    'G92 X0',
    'G83 Z-5 Q1 R2',
    'G73 Z-5 Q1 R2',
    'M98 P100',
    'G53 G0 Z0',
    'G52 X5',
    'G0.25 X1',
  ])('%s', (line) => {
    const r = read(PRE + line);
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.moves).toHaveLength(2); // nothing from the line was executed
  });
});

describe('adversarial modal state', () => {
  it('G91 relative moves, then G90 absolute', () => {
    const r = read(PRE + 'G91\nG1 X5\nG1 X5 Y2\nG90\nG1 X1');
    expect(r.errors).toEqual([]);
    expect(r.moves.slice(2).map((m) => [m.to.x, m.to.y])).toEqual([
      [5, 0],
      [10, 2],
      [1, 2],
    ]);
    expect(r.finalState.distance).toBe('G90');
    expect(r.finalState.explicit.distance).toBe(true);
  });

  it('G91 from an assumed position warns INCREMENTAL_FROM_UNKNOWN and marks the axis assumed', () => {
    const r = read('G21 G17 G54 G91\nG0 X5\nG1 Y1 F10');
    expect(wcodes(r)).toContain('INCREMENTAL_FROM_UNKNOWN');
    expect(r.moves[0]!.assumedAxes).toContain('x');
    expect(r.finalState.explicit.distance).toBe(true);
  });

  it('defaults are assumed and recorded as not explicit', () => {
    const r = read('G0 Z20\nG1 X1 F100\nM30');
    expect(r.finalState.units).toBe('G21');
    expect(r.finalState.distance).toBe('G90');
    expect(r.finalState.plane).toBe('G17');
    expect(r.finalState.wcs).toBe('G54');
    expect(r.finalState.arcDistance).toBe('G91.1');
    expect(r.finalState.explicit).toEqual({
      units: false,
      distance: false,
      arcDistance: false,
      plane: false,
      wcs: false,
    });
    const set = read('G21 G90 G17 G54 G91.1\nG0 Z20\nM30');
    expect(set.finalState.explicit).toEqual({
      units: true,
      distance: true,
      arcDistance: true,
      plane: true,
      wcs: true,
    });
  });

  it('G20 then G21 in one program converts each stretch in its own unit and warns once', () => {
    const r = read('G20 G90 G17 G54\nG0 Z1\nG1 X1 F10\nG21\nG1 X1\nG20\nG1 X1');
    expect(r.errors).toEqual([]);
    expect(wcodes(r).filter((c) => c === 'INCH_UNITS')).toHaveLength(1);
    expect(r.moves.map((m) => m.to.z)).toEqual([25.4, 25.4, 25.4, 25.4]);
    expect(r.moves.map((m) => m.to.x)).toEqual([0, 25.4, 1, 25.4]);
    expect(r.moves[1]!.feed).toBeCloseTo(254, 9); // F10 in/min
    expect(r.moves[2]!.feed).toBeCloseTo(254, 9); // G21 without new F keeps the converted value
  });

  it('G20 and G21 on one line is MODAL_GROUP_CONFLICT', () => {
    expect(codes(read(PRE + 'G20 G21'))).toContain('MODAL_GROUP_CONFLICT');
  });

  it('G0 and G1 on one line is MODAL_GROUP_CONFLICT; duplicate X is DUPLICATE_WORD', () => {
    expect(codes(read(PRE + 'G0 G1 X1'))).toContain('MODAL_GROUP_CONFLICT');
    expect(codes(read(PRE + 'G1 X1 X2'))).toContain('DUPLICATE_WORD');
  });

  it('axis words with no motion mode ever set is NO_MOTION_MODE', () => {
    expect(codes(read('G21 G90 G17 G54\nX5'))).toContain('NO_MOTION_MODE');
  });

  it('lower case is read like upper case', () => {
    const r = read('g21 g90 g17 g54\ng0 z20\nm3 s100\ng1 x1 f10\nm30');
    expect(r.errors).toEqual([]);
    expect(r.moves[1]!.to.x).toBe(1);
  });

  it('F <= 0, negative S, fractional T are INVALID_VALUE', () => {
    expect(codes(read(PRE + 'F0'))).toContain('INVALID_VALUE');
    expect(codes(read(PRE + 'F-5'))).toContain('INVALID_VALUE');
    expect(codes(read(PRE + 'S-100'))).toContain('INVALID_VALUE');
    expect(codes(read(PRE + 'T1.5'))).toContain('INVALID_VALUE');
  });

  it('negative S does not change the spindle speed', () => {
    const r = read(PRE + 'S-100\nG1 X1');
    expect(r.moves[2]!.rpm).toBe(18000);
  });

  it('M3 without S (and no S before): reported faithfully as rpm null with the spindle on', () => {
    const r = read('G21 G90 G17 G54\nG0 Z20\nM3\nG1 X1 F100\nM30');
    const spindle = r.events.find((e) => e.kind === 'spindle');
    expect(spindle).toMatchObject({ kind: 'spindle', state: 'cw', rpm: null });
    expect(r.moves[1]!.spindleOn).toBe(true);
    expect(r.moves[1]!.rpm).toBeNull(); // T019 must judge this (rule 4); the reader must not invent a speed
  });

  it('T without M6 only selects: the tool in the spindle stays null', () => {
    const r = read(PRE + 'T2\nG1 X1');
    expect(r.finalState.selectedTool).toBe(2);
    expect(r.finalState.tool).toBeNull();
    expect(r.moves[2]!.tool).toBeNull();
    expect(r.events.some((e) => e.kind === 'toolChange')).toBe(false);
  });

  it('M6 without T warns; T then M6 changes the tool; M3 and M5 in one line conflict', () => {
    expect(wcodes(read(PRE + 'M6'))).toContain('TOOL_CHANGE_WITHOUT_T');
    const r = read(PRE + 'T3 M6\nG1 X1');
    expect(r.moves[2]!.tool).toBe(3);
    expect(codes(read(PRE + 'M3 M5'))).toContain('MODAL_GROUP_CONFLICT');
  });

  it('a line with only N10 is accepted and changes nothing', () => {
    const r = read(PRE + 'N10\nN20 G1 X1');
    expect(r.errors).toEqual([]);
    expect(r.moves).toHaveLength(3);
    expect(r.moves[2]!.block).toBe(20);
  });

  it('G0 Z-5 (rapid into material) is read faithfully, with no error: judging is T019', () => {
    const r = read(PRE + 'G0 Z-5\nM30');
    expect(r.errors).toEqual([]);
    const m = r.moves[2]!;
    expect(m.type).toBe('rapid');
    expect(m.to.z).toBe(-5);
    expect(m.from.z).toBe(20);
    expect(m.feed).toBeNull();
  });

  it('a missing M30 is NO_PROGRAM_END (warning); code after M30 is CODE_AFTER_END and not executed', () => {
    const r = read(PRE + 'G1 X1');
    expect(r.errors).toEqual([]);
    expect(wcodes(r)).toContain('NO_PROGRAM_END');
    expect(r.finalState.ended).toBe(false);
    const after = read(PRE + 'M30\nG1 X5');
    expect(wcodes(after)).toContain('CODE_AFTER_END');
    expect(after.moves).toHaveLength(2);
  });

  it('a feed move with no F ever given gets feed null and a FEED_UNDEFINED warning', () => {
    const r = read('G21 G90 G17 G54\nG0 Z20\nM3 S100\nG1 X1');
    expect(r.moves[1]!.feed).toBeNull();
    expect(wcodes(r)).toContain('FEED_UNDEFINED');
    expect(r.events.some((e) => e.kind === 'missingFeed')).toBe(true);
  });

  it('G4 P is seconds by default, milliseconds on request; negative or missing time is an error', () => {
    const s = read(PRE + 'G4 P5');
    expect(s.events.find((e) => e.kind === 'dwell')).toMatchObject({ seconds: 5 });
    const ms = read(PRE + 'G4 P5000', { dwellUnit: 'ms' });
    expect(ms.events.find((e) => e.kind === 'dwell')).toMatchObject({ seconds: 5 });
    expect(codes(read(PRE + 'G4'))).toContain('INVALID_VALUE');
    expect(codes(read(PRE + 'G4 P-1'))).toContain('INVALID_VALUE');
  });
});

describe('adversarial text structure', () => {
  it('a comment with a ")" inside ends at the first ")": the rest is an error, line not executed', () => {
    const r = read(PRE + 'G1 X1 F100 (a ) b)\nG1 X2');
    expect(r.ok).toBe(false);
    expect(r.errors.every((e) => e.line === 5)).toBe(true);
    expect(r.moves.map((m) => m.to.x)).toEqual([0, 0, 2]); // X1 line skipped, X2 line read
  });

  it('nested parentheses are not comments-in-comments: error, never a silent misread', () => {
    const r = read(PRE + 'G1 X1 (a (b) c)\nG1 X2');
    expect(r.ok).toBe(false);
    expect(r.moves.some((m) => m.to.x === 1)).toBe(false);
  });

  it('an unclosed ( is UNCLOSED_COMMENT and the line is not executed; the next line is read', () => {
    const r = read(PRE + 'G1 X1 (abc\nG1 X2');
    expect(codes(r)).toContain('UNCLOSED_COMMENT');
    expect(r.moves.map((m) => m.to.x)).toEqual([0, 0, 2]);
  });

  it('a ";" comment hides everything after it, including a "("', () => {
    const r = read(PRE + 'G1 X1 ; (open\nG1 X2');
    expect(r.errors).toEqual([]);
    expect(r.moves.map((m) => m.to.x)).toEqual([0, 0, 1, 2]);
  });

  it('a UTF-8 BOM is not read as a word', () => {
    const r = read('﻿' + PRE + 'G1 X1\nM30');
    expect(r.errors).toEqual([]);
    expect(r.moves[0]!.to.z).toBe(20);
    expect(r.moves[2]!.to.x).toBe(1);
  });

  it('binary garbage is an error per line, never an exception, never a move', () => {
    const garbage = Array.from({ length: 4096 }, (_, i) =>
      String.fromCharCode((i * 131) % 256),
    ).join('');
    const r = read(PRE + garbage + '\nM30');
    expect(r.ok).toBe(false);
    expect(r.moves).toHaveLength(2);
    const bytes = read(PRE + '\u0000\u0001ÿþ G1 X1 \u007f F100');
    expect(codes(bytes)).toContain('UNEXPECTED_CHARACTER');
    expect(bytes.moves).toHaveLength(2);
  });

  it('control characters and unicode text inside comments are harmless', () => {
    const r = read(PRE + 'G1 X1 (Türkçe çğıöşü \u0000  )\nM30');
    expect(r.errors).toEqual([]);
    expect(r.moves[2]!.to.x).toBe(1);
  });

  it('% markers: leading and closing % are fine; code after the closing % is warned and skipped', () => {
    const ok = read('%\n' + PRE + 'M30\n%\n');
    expect(ok.errors).toEqual([]);
    const after = read('%\n' + PRE + 'M30\n%\nG1 X9');
    expect(wcodes(after)).toContain('CONTENT_AFTER_END_MARKER');
    expect(after.moves).toHaveLength(2);
  });

  it('empty, blank and marker-only files are EMPTY_PROGRAM errors', () => {
    for (const t of ['', '   \n\n', '%', '(only a comment)']) {
      expect(codes(read(t))).toContain('EMPTY_PROGRAM');
    }
  });

  it('CRLF, LF, CR and mixed endings split lines the same way and are reported', () => {
    const body = ['G21', 'G90', 'G17', 'G54', 'G0 Z5', 'M30'];
    const lf = read(body.join('\n'));
    const crlf = read(body.join('\r\n'));
    const cr = read(body.join('\r'));
    expect(lf.lineEnding).toBe('lf');
    expect(crlf.lineEnding).toBe('crlf');
    expect(cr.lineEnding).toBe('cr');
    expect(read('G21\r\nG90\nG17').lineEnding).toBe('mixed');
    expect(crlf.moves).toEqual(lf.moves);
    expect(cr.moves).toEqual(lf.moves);
  });

  it('block delete lines are skipped with a warning by default', () => {
    const r = read(PRE + '/G1 X9\nG1 X1');
    expect(wcodes(r)).toContain('BLOCK_DELETE');
    expect(r.moves.map((m) => m.to.x)).toEqual([0, 0, 1]);
  });
});

describe('very large input', () => {
  it('a 1 MB single line of words: no throw, no NaN, finishes quickly', () => {
    const line = 'G1 X1 '.repeat(Math.ceil(1_000_000 / 6));
    const t0 = performance.now();
    const r = read(PRE + line);
    expect(performance.now() - t0).toBeLessThan(2000 * BUDGET);
    expect(r.ok).toBe(false); // duplicate words
    expect(codes(r)).toContain('DUPLICATE_WORD');
    expect(r.moves).toHaveLength(2);
  });

  it('a 1 MB single number, comment, unclosed comment and garbage line', () => {
    const MB = 1_000_000;
    const cases: [string, string | null][] = [
      ['G1 X' + '1'.repeat(MB), 'INVALID_NUMBER'],
      ['G1 X1 (' + 'a'.repeat(MB) + ')', null],
      ['G1 X1 (' + 'a'.repeat(MB), 'UNCLOSED_COMMENT'],
      ['%'.repeat(MB), null],
      ['(' + ')'.repeat(MB), null],
      ['X'.repeat(MB), null],
      ['G'.repeat(MB), null],
      ['\u0000'.repeat(MB), null],
    ];
    for (const [line, code] of cases) {
      const t0 = performance.now();
      const r = read(PRE + line + '\nG1 X2');
      expect(performance.now() - t0, line.slice(0, 20)).toBeLessThan(2000 * BUDGET);
      if (code) expect(codes(r)).toContain(code);
      expect(r.moves[r.moves.length - 1]!.to.x).toBe(2); // the following line is still read
    }
  });

  it('a 1 MB file of one-word lines', () => {
    const r = read(PRE + 'N1\n'.repeat(300_000));
    expect(r.errors).toEqual([]);
  });
});

/** A realistic Mach3 program with the words that the strict reader does not model. */
const MACH3_FILE = [
  '%',
  '(Kabin kapaklari - Mach3 ornek)',
  'N10 G21 G90 G17 G54 G91.1',
  'G61',
  'G64 P0.05',
  'M10',
  'N20 T2 M6',
  'M3 S18000',
  'G4 P5',
  'G0 Z20',
  'G0 X100 Y100 A0',
  'G0 Z2',
  'G1 Z-3 F1500',
  'G1 X200 Y100 F6000',
  'G2 X200 Y200 I0 J50',
  'G1 X100 Y200',
  'G1 X100 Y100',
  'G0 Z20',
  'M5',
  'M30',
  '%',
  '',
].join('\r\n');

describe('strict vs non-strict on a realistic Mach3 file', () => {
  it('strict (default): G61 and G64 are modelled no-ops; A0 and M10 are UNKNOWN_WORD errors, lines not run', () => {
    const r = read(MACH3_FILE);
    expect(r.ok).toBe(false);
    const unknown = r.errors.filter((e) => e.code === 'UNKNOWN_WORD');
    expect(unknown.length).toBeGreaterThanOrEqual(2);
    expect(r.errors.every((e) => e.code === 'UNKNOWN_WORD')).toBe(true);
    const lineOf = (needle: string) =>
      MACH3_FILE.split('\r\n').findIndex((l) => l.includes(needle)) + 1;
    expect(unknown.map((e) => e.line)).toEqual(
      expect.arrayContaining([lineOf('A0'), lineOf('M10')]),
    );
    // the line with A0 is a move that is NOT executed in strict mode
    expect(r.moves.some((m) => m.line === lineOf('A0'))).toBe(false);
    expect(r.lines[lineOf('A0') - 1]!.skipped).toBe(true);
    expect(r.lines[lineOf('M10') - 1]!.skipped).toBe(true);
    // G61 and G64 P0.05 are harmless modelled codes in this reader
    expect(r.errors.some((e) => e.line === lineOf('G61') || e.line === lineOf('G64'))).toBe(false);
  });

  it('strict: UNKNOWN_WORD is an error for unknown G, M and letters', () => {
    for (const w of [
      'G7',
      'G61.1',
      'M10',
      'M11',
      'A5',
      'B5',
      'C5',
      'E5',
      'H1',
      'L2',
      'U1',
      'V1',
      'W1',
    ]) {
      const r = read(PRE + w);
      expect(codes(r), w).toContain('UNKNOWN_WORD');
      expect(r.ok, w).toBe(false);
    }
  });

  it('non-strict: only UNKNOWN_WORD becomes a warning; the XYZ moves are read as written', () => {
    const strict = read(MACH3_FILE);
    const loose = read(MACH3_FILE, { strict: false });
    expect(loose.errors).toEqual([]);
    expect(loose.ok).toBe(true);
    const warn = loose.warnings.filter((w) => w.code === 'UNKNOWN_WORD');
    expect(warn.length).toBe(strict.errors.filter((e) => e.code === 'UNKNOWN_WORD').length);
    for (const w of warn) expect(w.severity).toBe('warning');
    const xy = loose.moves.map((m) => [m.type, m.to.x, m.to.y, m.to.z]);
    expect(xy).toEqual([
      ['rapid', 0, 0, 20],
      ['rapid', 100, 100, 20],
      ['rapid', 100, 100, 2],
      ['feed', 100, 100, -3],
      ['feed', 200, 100, -3],
      ['arcCw', 200, 200, -3],
      ['feed', 100, 200, -3],
      ['feed', 100, 100, -3],
      ['rapid', 100, 100, 20],
    ]);
    const arc = loose.moves[5]!;
    expect(arc.arc!.cx).toBeCloseTo(200, 9);
    expect(arc.arc!.cy).toBeCloseTo(150, 9);
    expect(arc.arc!.sweep).toBeCloseTo(Math.PI, 9);
    expect(loose.moves[4]!.feed).toBe(6000);
    expect(loose.moves[3]!.feed).toBe(1500);
    expect(loose.moves[4]!.spindleOn).toBe(true);
    expect(loose.moves[4]!.tool).toBe(2);
    expect(loose.finalState.ended).toBe(true);
    expect(loose.finalState.spindle).toBe('off');
  });

  it('non-strict does not relax any other error', () => {
    for (const bad of [
      'G28 Z0',
      'G41 D1',
      'G43 H1',
      'G92 X0',
      'G83 Z-5 Q1 R2',
      'M98 P1',
      'G18',
      'G1 X1e3',
      'G2 X10 Y0',
    ]) {
      const r = read(PRE + bad, { strict: false });
      expect(r.ok, bad).toBe(false);
    }
  });

  it('options.extraMCodes turns a machine specific M code into an event instead of an error', () => {
    const r = read(PRE + 'M10', { extraMCodes: [10] });
    expect(r.errors).toEqual([]);
    expect(r.events.some((e) => e.kind === 'mcode' && e.code === 10)).toBe(true);
  });
});

describe('performance: 100k lines', () => {
  const lines: string[] = ['G21 G90 G17 G54', 'G0 Z20', 'M3 S18000', 'G1 X0 Y0 F6000'];
  for (let i = 0; i < 100_000 - 5; i++) {
    const x = ((i * 7) % 1000) + 0.125;
    const y = ((i * 13) % 600) + 0.25;
    if (i % 5 === 0) lines.push(`N${i} G2 X${x.toFixed(3)} Y${y.toFixed(3)} I0.5 J0 ; arc`);
    else if (i % 5 === 1) lines.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} Z-3.000 F1500 (cut)`);
    else lines.push(`G1 X${x.toFixed(3)} Y${y.toFixed(3)}`);
  }
  lines.push('M30');
  const text = lines.join('\r\n') + '\r\n';

  it.each([1, 2, 3])('run %i reads 100k lines in under 2 s', () => {
    expect(lines.length).toBe(100_000);
    const t0 = performance.now();
    const r = readGcode(text);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(2000 * BUDGET);
    // arcs with I0.5 from random points are radius mismatches: the reader still finishes and reports
    expect(r.lines).toHaveLength(100_000);
    expect(r.moves.length + r.errors.length).toBeGreaterThan(90_000);
    console.log(
      `T018 perf run: ${ms.toFixed(0)} ms, ${r.moves.length} moves, ${r.errors.length} errors`,
    );
  });

  it('a clean 100k-line program (lines and snapshots on) also stays under 2 s', () => {
    const clean: string[] = ['G21 G90 G17 G54', 'G0 Z20', 'M3 S18000', 'G1 X0 Y0 F6000'];
    for (let i = 0; i < 99_990; i++) {
      clean.push(i % 2 ? `G1 X${i % 1000}.500 Y${i % 600}.250 F1500` : `G1 X${i % 1000}.250 Y1`);
    }
    clean.push('M30');
    const t0 = performance.now();
    const r = readGcode(clean.join('\n'));
    expect(performance.now() - t0).toBeLessThan(2000 * BUDGET);
    expect(r.errors).toEqual([]);
    expect(r.moves.length).toBeGreaterThan(99_000);
  });
});
