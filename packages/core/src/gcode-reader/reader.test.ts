/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known results */
import { describe, expect, it } from 'vitest';
import { lexLine } from './lexer';
import { readGcode } from './reader';
import type { GcodeIssueCode, GcodeReadResult } from './types';

const codes = (r: GcodeReadResult, kind: 'errors' | 'warnings' = 'errors'): GcodeIssueCode[] =>
  r[kind].map((i) => i.code);

const close = (a: number, b: number, tol = 1e-9): void => {
  expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
};

// Hand-written Mach3-style program (CRLF, parenthesis comments, G91.1, vacuum on M7, M0 tool
// pause, G4 P in seconds, two-pass rounded rectangle with incremental I/J).
const MACH3 = [
  '(Mach3 test program)',
  '(T2 D8.000)',
  'G21 G90 G91.1 G17 G40 G49 G54',
  'G0 Z20.0000',
  'M7',
  '(TAKIM T2 TAKILI MI?)',
  'M0',
  'M3 S18000',
  'G4 P5.0',
  'G0 X206.0000 Y268.0000',
  'G0 Z2.0000',
  'G1 Z-4.6250 F1500',
  'G3 X210.0000 Y264.0000 I4.0000 J0.0000 F6000',
  'G1 X390.0000',
  'G2 X414.0000 Y240.0000 I0.0000 J-24.0000',
  'G1 Y30.0000',
  'G2 X390.0000 Y6.0000 I-24.0000 J0.0000',
  'G1 X30.0000',
  'G2 X6.0000 Y30.0000 I0.0000 J24.0000',
  'G1 Y240.0000',
  'G2 X30.0000 Y264.0000 I24.0000 J0.0000',
  'G1 X210.0000',
  'G0 Z20.0000',
  'M5',
  'M9',
  'M30',
  '',
].join('\r\n');

// Fanuc-style: % markers, N numbers, leading-zero codes, no spaces, ; comments, G90.1 absolute
// centres, T M6 tool change, G4 X (seconds).
const FANUC = `%
O1000 (FANUC STYLE)
N10 G21 G17 G90 G90.1 G54
N20 T1 M06
N30 S12000 M03
N40 G04 X2.
N50 G00 X0. Y0. Z25.
N60 G00 X10. Y0.
N70 Z1.
N80 G01 Z-3. F800 ; plunge
N90 G01X50.F2000
N100 G03 X60. Y10. I50. J10.
N110 G01 Y40.
N120 G02 X50. Y50. I50. J40.
N130 G00 Z25.
N140 M05
N150 M30
%
`;

// Inch program: every length converted to mm, G20 flagged.
const INCH = `G20 G90 G17 G54 (inch)
G0 Z1.
M3 S10000
G1 Z-0.25 F20.
X2. Y1.
G2 X3. Y2. R1.
M5
M2
`;

describe('lexer', () => {
  it('reads words without whitespace, any case, with or without leading zeros', () => {
    const l = lexLine('n5g1x10Y-.5z+3. f1500');
    expect(l.error).toBeNull();
    expect(l.words.map((w) => [w.letter, w.value])).toEqual([
      ['N', 5],
      ['G', 1],
      ['X', 10],
      ['Y', -0.5],
      ['Z', 3],
      ['F', 1500],
    ]);
  });

  it('collects ( ) and ; comments and flags block delete and %', () => {
    const l = lexLine('/G0 X1 (move) Y2 ; tail (x)');
    expect(l.blockDelete).toBe(true);
    expect(l.comments).toEqual(['move', 'tail (x)']);
    expect(l.words.map((w) => w.letter)).toEqual(['G', 'X', 'Y']);
    expect(lexLine('%').percent).toBe(true);
  });

  it.each([
    ['G1 X1e3', 'EXPONENT_NUMBER'],
    ['G1 X1.5E-2', 'EXPONENT_NUMBER'],
    ['G1 X2e+1', 'EXPONENT_NUMBER'],
    ['G1 XNaN', 'INVALID_NUMBER'],
    ['G1 XInfinity', 'INVALID_NUMBER'],
    ['G1 X-', 'INVALID_NUMBER'],
    ['G1 X', 'INVALID_NUMBER'],
    ['G1 X.', 'INVALID_NUMBER'],
    ['G1 X1.2.3', 'INVALID_NUMBER'],
    ['G1 X--1', 'INVALID_NUMBER'],
    ['G1 X1 (open', 'UNCLOSED_COMMENT'],
    ['#1=5', 'UNEXPECTED_CHARACTER'],
    ['G1 X1 [2]', 'UNEXPECTED_CHARACTER'],
  ])('%s → %s', (line, code) => {
    expect(lexLine(line).error?.code).toBe(code);
  });

  it('normalises -0 to 0', () => {
    expect(Object.is(lexLine('X-0.000').words[0]!.value, 0)).toBe(true);
  });
});

describe('readGcode: Mach3-style sample', () => {
  const r = readGcode(MACH3);

  it('reads cleanly with CRLF', () => {
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.lineEnding).toBe('crlf');
    expect(r.lines).toHaveLength(26);
  });

  it('records explicit modal state and the arc mode', () => {
    const s = r.lines[2]!.state;
    expect(s.explicit).toEqual({
      units: true,
      distance: true,
      arcDistance: true,
      plane: true,
      wcs: true,
    });
    expect(s.arcDistance).toBe('G91.1');
    expect(r.lines[0]!.state.explicit.arcDistance).toBe(false);
  });

  it('produces the moves with feed, spindle, line numbers', () => {
    expect(r.moves).toHaveLength(15);
    const first = r.moves[0]!;
    expect(first).toMatchObject({ type: 'rapid', line: 4, spindleOn: false, feed: null });
    expect(first.to.z).toBe(20);
    expect(first.assumedAxes).toEqual(['x', 'y']);
    const plunge = r.moves.find((m) => m.line === 12)!;
    expect(plunge).toMatchObject({ type: 'feed', feed: 1500, feedExplicit: true, spindleOn: true });
    expect(plunge.rpm).toBe(18000);
    expect(plunge.assumedAxes).toEqual([]);
    const lead = r.moves.find((m) => m.line === 13)!;
    expect(lead.type).toBe('arcCcw');
    expect(lead.arc).toMatchObject({ cx: 210, cy: 268, radius: 4, direction: 'ccw', form: 'ij' });
    close(lead.arc!.sweep, Math.PI / 2);
    const corner = r.moves.find((m) => m.line === 15)!;
    expect(corner.type).toBe('arcCw');
    expect(corner.arc).toMatchObject({ cx: 390, cy: 240, radius: 24 });
    close(corner.arc!.sweep, Math.PI / 2);
    // Modal feed carried over from line 13.
    expect(r.moves.find((m) => m.line === 14)).toMatchObject({ feed: 6000, feedExplicit: false });
  });

  it('emits the events in order', () => {
    expect(r.events.map((e) => e.kind)).toEqual([
      'coolant',
      'pause',
      'spindle',
      'dwell',
      'spindle',
      'coolant',
      'end',
    ]);
    expect(r.events[3]).toMatchObject({ kind: 'dwell', seconds: 5, line: 9, moveIndex: 1 });
    expect(r.events[2]).toMatchObject({ state: 'cw', rpm: 18000 });
    expect(r.finalState.ended).toBe(true);
    expect(r.finalState.spindle).toBe('off');
  });

  it('reads the same with LF and with ms dwell unit', () => {
    const lf = readGcode(MACH3.replace(/\r\n/g, '\n'), { dwellUnit: 'ms' });
    expect(lf.lineEnding).toBe('lf');
    expect(lf.moves).toEqual(r.moves);
    expect(lf.events.find((e) => e.kind === 'dwell')).toMatchObject({ seconds: 0.005 });
  });
});

describe('readGcode: Fanuc-style sample', () => {
  const r = readGcode(FANUC);

  it('reads N numbers, % markers, O number and leading zeros', () => {
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.moves.map((m) => m.block)).toEqual([50, 60, 70, 80, 90, 100, 110, 120, 130]);
    expect(r.lines[5]!.block).toBe(40);
    expect(r.lines[9]!.comments).toEqual(['plunge']);
  });

  it('tool change, G4 X in seconds, absolute arc centres', () => {
    expect(r.events[0]).toMatchObject({ kind: 'toolChange', tool: 1, line: 4 });
    expect(r.events.find((e) => e.kind === 'dwell')).toMatchObject({ seconds: 2 });
    expect(r.moves.every((m) => m.tool === 1)).toBe(true);
    const a = r.moves.find((m) => m.block === 100)!;
    expect(a.arc).toMatchObject({ cx: 50, cy: 10, radius: 10, direction: 'ccw' });
    close(a.arc!.sweep, Math.PI / 2);
    const b = r.moves.find((m) => m.block === 120)!;
    expect(b.arc).toMatchObject({ cx: 50, cy: 40, radius: 10, direction: 'cw' });
    expect(b.to).toEqual({ x: 50, y: 50, z: -3 });
  });

  it('modal motion carries: "Z1." after G00 is a rapid; "G01X50.F2000" sets the feed', () => {
    expect(r.moves.find((m) => m.block === 70)).toMatchObject({ type: 'rapid' });
    expect(r.moves.find((m) => m.block === 90)).toMatchObject({ feed: 2000, feedExplicit: true });
    expect(r.moves.find((m) => m.block === 110)).toMatchObject({ type: 'feed', feed: 2000 });
  });

  it('ignores text after the closing %', () => {
    const t = readGcode(FANUC + 'G0 X999\n');
    expect(codes(t, 'warnings')).toEqual(['CONTENT_AFTER_END_MARKER']);
    expect(t.moves).toHaveLength(9);
  });
});

describe('readGcode: inch program', () => {
  const r = readGcode(INCH);

  it('converts to mm and flags G20', () => {
    expect(r.ok).toBe(true);
    expect(codes(r, 'warnings')).toEqual(['INCH_UNITS']);
    expect(r.finalState.units).toBe('G20');
    const plunge = r.moves[1]!;
    close(plunge.to.z, -6.35);
    close(plunge.feed!, 508);
    const lin = r.moves[2]!;
    close(lin.to.x, 50.8);
    close(lin.to.y, 25.4);
    const arc = r.moves[3]!;
    close(arc.arc!.radius, 25.4);
    close(arc.to.x, 76.2);
    // G2 from (2,1) to (3,2) with R1 (≤ 180°): centre (3,1) in inches.
    close(arc.arc!.cx, 76.2, 1e-9);
    close(arc.arc!.cy, 25.4, 1e-9);
    close(arc.arc!.sweep, Math.PI / 2);
  });
});

describe('arcs', () => {
  const head = 'G21 G90 G17 G54 F1000\nG0 X10 Y0 Z0\n';

  it('I/J incremental (default, not explicit) half circle', () => {
    const r = readGcode(head + 'G3 X-10 Y0 I-10 J0\nM30\n');
    expect(r.ok).toBe(true);
    const m = r.moves[1]!;
    expect(m.arc).toMatchObject({ cx: 0, cy: 0, radius: 10 });
    close(m.arc!.sweep, Math.PI);
    expect(r.finalState.arcDistance).toBe('G91.1');
    expect(r.finalState.explicit.arcDistance).toBe(false);
  });

  it('I/J absolute with G90.1', () => {
    const r = readGcode(head + 'G90.1\nG2 X0 Y-10 I0 J0\nM30\n');
    const m = r.moves[1]!;
    expect(m.arc).toMatchObject({ cx: 0, cy: 0, radius: 10, direction: 'cw' });
    close(m.arc!.sweep, Math.PI / 2);
    expect(r.finalState.explicit.arcDistance).toBe(true);
  });

  it('arcDistanceDefault option switches the assumed mode', () => {
    const r = readGcode(head + 'G2 X0 Y-10 I0 J0\nM30\n', { arcDistanceDefault: 'G90.1' });
    expect(r.moves[1]!.arc).toMatchObject({ cx: 0, cy: 0 });
  });

  it('full circle with I/J (start = end)', () => {
    const r = readGcode(head + 'G2 I-10 J0\nM30\n');
    const m = r.moves[1]!;
    expect(m.to).toEqual(m.from);
    close(m.arc!.sweep, 2 * Math.PI);
  });

  it('R positive (≤ 180°) and negative (> 180°), both directions', () => {
    // From (10,0) to (0,10), radius 10.
    const pos = readGcode(head + 'G3 X0 Y10 R10\nM30\n').moves[1]!;
    expect(pos.arc!.cx).toBeCloseTo(0, 9);
    expect(pos.arc!.cy).toBeCloseTo(0, 9);
    close(pos.arc!.sweep, Math.PI / 2, 1e-9);
    const neg = readGcode(head + 'G3 X0 Y10 R-10\nM30\n').moves[1]!;
    expect(neg.arc!.cx).toBeCloseTo(10, 9);
    expect(neg.arc!.cy).toBeCloseTo(10, 9);
    close(neg.arc!.sweep, (3 * Math.PI) / 2, 1e-9);
    const cwPos = readGcode(head + 'G2 X0 Y10 R10\nM30\n').moves[1]!;
    expect(cwPos.arc!.cx).toBeCloseTo(10, 9);
    expect(cwPos.arc!.cy).toBeCloseTo(10, 9);
    close(cwPos.arc!.sweep, Math.PI / 2, 1e-9);
    const cwNeg = readGcode(head + 'G2 X0 Y10 R-10\nM30\n').moves[1]!;
    expect(cwNeg.arc!.cx).toBeCloseTo(0, 9);
    expect(cwNeg.arc!.cy).toBeCloseTo(0, 9);
    close(cwNeg.arc!.sweep, (3 * Math.PI) / 2, 1e-9);
  });

  it('helical arc keeps Z linear', () => {
    const r = readGcode(head + 'G3 X-10 Y0 Z-2 I-10 J0\nM30\n');
    expect(r.moves[1]!.to.z).toBe(-2);
  });

  it('errors: inconsistent radius, R too small, R full circle, zero radius, both R and IJ', () => {
    const bad = (body: string): GcodeIssueCode[] => codes(readGcode(head + body + '\nM30\n'));
    expect(bad('G3 X0 Y10.5 I-10 J0')).toEqual(['ARC_RADIUS_MISMATCH']);
    expect(bad('G3 X-10 Y0 R4')).toEqual(['ARC_INVALID']);
    expect(bad('G3 X10 Y0 R5')).toEqual(['ARC_INVALID']);
    expect(bad('G3 X0 Y10 I0 J0')).toEqual(['ARC_INVALID']);
    expect(bad('G3 X0 Y10 R10 I-10')).toEqual(['ARC_INVALID']);
    expect(bad('G3 X0 Y10')).toEqual(['ARC_INVALID']);
  });

  it('radius within the tolerance is accepted, configurable', () => {
    expect(readGcode(head + 'G3 X0 Y10.005 I-10 J0\nM30\n').ok).toBe(true);
    expect(readGcode(head + 'G3 X0 Y10.005 I-10 J0\nM30\n', { arcTolerance: 0.001 }).ok).toBe(
      false,
    );
  });

  it('a failed arc keeps the end position for the following lines', () => {
    const r = readGcode(head + 'G3 X0 Y10.5 I-10 J0\nG1 X5\nM30\n');
    expect(r.moves.at(-1)!.from).toEqual({ x: 0, y: 10.5, z: 0 });
  });

  it('an arc from an unknown XY position is an error', () => {
    const r = readGcode('G21 G90 F100\nG0 Z5\nG2 X1 Y1 I1 J0\nM30\n');
    expect(codes(r)).toEqual(['ARC_FROM_UNKNOWN_POSITION']);
  });
});

describe('modal state', () => {
  it('feed, motion and plane persist across lines', () => {
    const r = readGcode('G21 G90 G17 G54\nG0 X0 Y0 Z5\nG1 Z-1 F300\nX10\nY10\nG0 Z5\nX0\nM30\n');
    expect(r.ok).toBe(true);
    expect(r.moves.map((m) => [m.type, m.feed])).toEqual([
      ['rapid', null],
      ['feed', 300],
      ['feed', 300],
      ['feed', 300],
      ['rapid', null],
      ['rapid', null],
    ]);
    expect(r.lines.every((l) => l.state.plane === 'G17')).toBe(true);
    expect(r.lines[3]!.state.motion).toBe('G1');
  });

  it('G91 incremental and back to G90', () => {
    const r = readGcode('G21 G90\nG0 X10 Y10 Z5\nG91\nG0 X5 Y-2\nG0 Z-1\nG90\nG0 X1\nM30\n');
    expect(r.moves.map((m) => m.to)).toEqual([
      { x: 10, y: 10, z: 5 },
      { x: 15, y: 8, z: 5 },
      { x: 15, y: 8, z: 4 },
      { x: 1, y: 8, z: 4 },
    ]);
  });

  it('incremental move from an unknown position warns and keeps the axis assumed', () => {
    const r = readGcode('G91\nG0 X5\nM30\n', { initialPosition: { x: 1, y: 2, z: 3 } });
    expect(codes(r, 'warnings')).toEqual(['INCREMENTAL_FROM_UNKNOWN']);
    expect(r.moves[0]!.to).toEqual({ x: 6, y: 2, z: 3 });
    expect(r.moves[0]!.assumedAxes).toEqual(['x', 'y', 'z']);
  });

  it('work offset, G40/G49 accepted; defaults are not explicit', () => {
    const r = readGcode('G0 Z5\nG55 G40 G49\nM30\n');
    expect(r.errors).toEqual([]);
    expect(r.lines[0]!.state.explicit).toEqual({
      units: false,
      distance: false,
      arcDistance: false,
      plane: false,
      wcs: false,
    });
    expect(r.finalState.wcs).toBe('G55');
    expect(r.finalState.explicit.wcs).toBe(true);
  });

  it('spindle S change while running, M4, coolant M8 then M9, pause M1, extra M codes', () => {
    const r = readGcode('M3 S1000\nS2000\nM4\nM8\nM9\nM1\nM10\nM11\nM2\n', { extraMCodes: [10] });
    expect(r.events.map((e) => e.kind)).toEqual([
      'spindle',
      'spindle',
      'spindle',
      'coolant',
      'coolant',
      'pause',
      'mcode',
      'end',
    ]);
    expect(r.events[1]).toMatchObject({ state: 'cw', rpm: 2000 });
    expect(r.events[2]).toMatchObject({ state: 'ccw', rpm: 2000 });
    expect(r.events[5]).toMatchObject({ optional: true });
    expect(r.events[6]).toMatchObject({ code: 10 });
    expect(r.events[7]).toMatchObject({ code: 'M2' });
    // M11 is not listed in extraMCodes: an error in strict mode (the default).
    expect(r.errors).toMatchObject([{ code: 'UNKNOWN_WORD', line: 8, severity: 'error' }]);
  });

  it('M6 without a T warns; tool is null on later moves', () => {
    const r = readGcode('M6\nG0 Z5\nM30\n');
    expect(codes(r, 'warnings')).toEqual(['TOOL_CHANGE_WITHOUT_T']);
    expect(r.moves[0]!.tool).toBeNull();
  });

  it('T without M6 only selects the tool', () => {
    const r = readGcode('T3\nG0 Z5\nM6\nG0 Z6\nM30\n');
    expect(r.moves[0]!.tool).toBeNull();
    expect(r.moves[1]!.tool).toBe(3);
    expect(r.lines[0]!.state.selectedTool).toBe(3);
  });

  it('missing F on the first feed move: an event + warning, not a crash or an error', () => {
    const r = readGcode('G21 G90\nG0 X0 Y0 Z5\nG1 Z-1\nM30\n');
    expect(r.ok).toBe(true);
    expect(codes(r, 'warnings')).toEqual(['FEED_UNDEFINED']);
    expect(r.events[0]).toMatchObject({ kind: 'missingFeed', line: 3, moveIndex: 1 });
    expect(r.moves[1]!.feed).toBeNull();
  });

  it('code after M30 is not executed', () => {
    const r = readGcode('G0 Z5\nM30\nG0 Z10\n');
    expect(codes(r, 'warnings')).toEqual(['CODE_AFTER_END']);
    expect(r.moves).toHaveLength(1);
    expect(r.lines[2]!.skipped).toBe(true);
  });

  it('block delete: skipped by default, executed on request, both flagged', () => {
    const skip = readGcode('G0 Z5\n/G0 Z10\nM30\n');
    expect(skip.moves).toHaveLength(1);
    expect(codes(skip, 'warnings')).toEqual(['BLOCK_DELETE']);
    const exec = readGcode('G0 Z5\n/G0 Z10\nM30\n', { blockDelete: 'execute' });
    expect(exec.moves).toHaveLength(2);
    expect(codes(exec, 'warnings')).toEqual(['BLOCK_DELETE']);
  });

  it('a lone % in the middle of the program, followed by code, warns PERCENT_MID_PROGRAM', () => {
    const mid = readGcode('G21 G90\nG0 Z5\n%\nG0 Z6\nM30\n');
    expect(mid.warnings).toMatchObject([{ code: 'PERCENT_MID_PROGRAM', line: 3 }]);
    expect(mid.moves).toHaveLength(2);
    // Second % mid-program: also the closing marker, code after it is ignored.
    const second = readGcode('%\nG21 G90\nG0 Z5\n%\nG0 Z6\nM30\n');
    expect(second.warnings.map((w) => w.code)).toEqual([
      'PERCENT_MID_PROGRAM',
      'CONTENT_AFTER_END_MARKER',
      'NO_PROGRAM_END',
    ]);
    // Leading and closing markers, and a % after M30 with nothing after it, are fine.
    expect(readGcode('%\nG0 Z5\nM30\n%\n').warnings).toEqual([]);
    expect(readGcode('G0 Z5\nM30\n%\n').warnings).toEqual([]);
    expect(readGcode('G0 Z5\nM30\n%\n(comment)\n\n').warnings).toEqual([]);
    // Comments and blank lines between the % and the next code do not hide it.
    expect(codes(readGcode('G0 Z5\n%\n(comment)\n\nM30\n'), 'warnings')).toEqual([
      'PERCENT_MID_PROGRAM',
    ]);
  });

  it('M3/M4 with no S ever set warns SPINDLE_NO_RPM; S before or on the line does not', () => {
    expect(readGcode('M3\nG0 Z5\nM30\n').warnings).toMatchObject([
      { code: 'SPINDLE_NO_RPM', line: 1 },
    ]);
    expect(codes(readGcode('M4\nM30\n'), 'warnings')).toEqual(['SPINDLE_NO_RPM']);
    expect(readGcode('M3 S1000\nM30\n').warnings).toEqual([]);
    expect(readGcode('S1000\nM3\nM5\nM3\nM30\n').warnings).toEqual([]);
    expect(readGcode('M5\nM30\n').warnings).toEqual([]);
  });

  it('a leading UTF-8 BOM is stripped with BOM_STRIPPED; a BOM elsewhere is an error', () => {
    const r = readGcode('﻿G0 Z5\nM30\n');
    expect(r.ok).toBe(true);
    expect(r.warnings).toMatchObject([{ code: 'BOM_STRIPPED', line: 1, severity: 'warning' }]);
    expect(r.moves[0]!.to.z).toBe(5);
    expect(codes(readGcode('G0 Z5\n﻿G0 Z6\nM30\n'))).toEqual(['UNEXPECTED_CHARACTER']);
  });

  it('no end code warns', () => {
    expect(codes(readGcode('G0 Z5\n'), 'warnings')).toEqual(['NO_PROGRAM_END']);
  });
});

describe('errors and warnings', () => {
  it.each([
    ['G18', 'UNSUPPORTED_PLANE'],
    ['G19 G0 X1', 'UNSUPPORTED_PLANE'],
    ['G28', 'UNSUPPORTED_CODE'],
    ['G43 H1', 'UNSUPPORTED_CODE'],
    ['G92 X0', 'UNSUPPORTED_CODE'],
    ['G83 X1 Y1 Z-1 Q1 R1', 'UNSUPPORTED_CODE'],
    ['G91 G81 X1 Y1 Z-1 R1', 'UNSUPPORTED_CODE'],
    ['M98 P100', 'UNSUPPORTED_CODE'],
    ['G0.25 X1', 'UNSUPPORTED_CODE'],
    ['G0 G1 X1', 'MODAL_GROUP_CONFLICT'],
    ['G20 G21', 'MODAL_GROUP_CONFLICT'],
    ['M3 M5', 'MODAL_GROUP_CONFLICT'],
    ['M8 M9', 'MODAL_GROUP_CONFLICT'],
    ['G0 X1 X2', 'DUPLICATE_WORD'],
    ['G1 X1 F0', 'INVALID_VALUE'],
    ['S-5', 'INVALID_VALUE'],
    ['T1.5', 'INVALID_VALUE'],
    ['G4', 'INVALID_VALUE'],
    ['G4 P-1', 'INVALID_VALUE'],
    ['G4 P1 X1', 'AXIS_WORD_CONFLICT'],
    ['G4 P1 Z1', 'AXIS_WORD_CONFLICT'],
    ['G1 G4 P1', 'MODAL_GROUP_CONFLICT'],
    ['X10', 'NO_MOTION_MODE'],
    ['G1 X1e3', 'EXPONENT_NUMBER'],
    ['G1 XNaN', 'INVALID_NUMBER'],
    ['G1 X-Infinity', 'INVALID_NUMBER'],
  ])('%s → %s', (line, code) => {
    const r = readGcode(`G21 G90\n${line}\nM30\n`);
    expect(r.ok).toBe(false);
    expect(codes(r)).toContain(code);
  });

  it('a line with an error changes nothing', () => {
    const r = readGcode('G21 G90\nG0 X1 Y1 Z1\nG0 X5e1 F100\nG1 X2\nM30\n');
    expect(r.lines[2]!.skipped).toBe(true);
    expect(r.lines[2]!.state.position).toEqual({ x: 1, y: 1, z: 1 });
    expect(r.lines[3]!.state.feed).toBeNull();
    expect(r.moves).toHaveLength(2);
  });

  it('the error carries the line number', () => {
    const r = readGcode('G21\nG0 Z5\nG18\nM30\n');
    expect(r.errors[0]).toMatchObject({ code: 'UNSUPPORTED_PLANE', line: 3, severity: 'error' });
  });

  it.each(['', '\n\n', '   \r\n', '(only a comment)\n; and another', '%\n%\n'])(
    'empty program %j → EMPTY_PROGRAM',
    (text) => {
      const r = readGcode(text);
      expect(r.ok).toBe(false);
      expect(codes(r)).toEqual(['EMPTY_PROGRAM']);
      expect(r.moves).toEqual([]);
    },
  );

  it('modelled no-op codes (G40 G49 G61 G64 G80 G94) and O are accepted in strict mode', () => {
    // G61 and G64 share a modal group, so they go on separate lines.
    const r = readGcode('O100\nG21 G90 G40 G49 G61 G80 G94\nG64\nG0 Z1\nM30\n');
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it.each([
    'G0 X1 Y1 Z1 A30',
    'G0 X1 B5',
    'G0 X1 C5',
    'G1 X1 E5 F100',
    'G0 U1',
    'G0 V1',
    'G0 W1',
    'G0 X1 Q2',
    'G0 X1 L2',
    'G0 X1 H2',
    'G61.1',
    'G7',
    'M10',
    'M50',
  ])('strict (default): %s → UNKNOWN_WORD error, line not run', (line) => {
    const r = readGcode(`G21 G90\nG0 X0 Y0 Z0\n${line}\nM30\n`);
    expect(r.ok).toBe(false);
    expect(r.errors).toMatchObject([{ code: 'UNKNOWN_WORD', severity: 'error', line: 3 }]);
    expect(r.lines[2]!.skipped).toBe(true);
    expect(r.moves).toHaveLength(1);
  });

  it('strict: false downgrades unknown words to warnings and ignores only the word', () => {
    const text = 'G21 G90 G64 G80 G94\nG0 X1 Y1 Z1 A30\nG61.1\nM10\nM30 E5\n';
    const r = readGcode(text, { strict: false });
    expect(r.ok).toBe(true);
    expect(r.warnings).toMatchObject([
      { code: 'UNKNOWN_WORD', severity: 'warning', line: 2 },
      { code: 'UNKNOWN_WORD', severity: 'warning', line: 3 },
      { code: 'UNKNOWN_WORD', severity: 'warning', line: 4 },
      { code: 'UNKNOWN_WORD', severity: 'warning', line: 5 },
    ]);
    expect(r.moves[0]!.to).toEqual({ x: 1, y: 1, z: 1 });
    expect(r.finalState.ended).toBe(true);
    // The same text in strict mode: four errors.
    expect(codes(readGcode(text))).toEqual(Array(4).fill('UNKNOWN_WORD'));
  });

  it('strict: false does not relax the other errors (unsupported codes, plane, exponents)', () => {
    const r = readGcode('G21 G90\nG28\nG18\nG0 X1e2\nM30\n', { strict: false });
    expect(codes(r)).toEqual(['UNSUPPORTED_CODE', 'UNSUPPORTED_PLANE', 'EXPONENT_NUMBER']);
  });

  it('ignored words: K, P outside G4, I/J on G1, N not first', () => {
    const r = readGcode('G21 G90 F100\nG0 X0 Y0 Z0\nG1 X1 I1 K2 P3\nG0 X2 N5\nM30\n');
    expect(codes(r, 'warnings')).toEqual([
      'IGNORED_WORD',
      'IGNORED_WORD',
      'IGNORED_WORD',
      'LINE_NUMBER_POSITION',
    ]);
  });

  it('mixed and bare-CR line endings are detected', () => {
    expect(readGcode('G0 Z1\r\nG0 Z2\nM30').lineEnding).toBe('mixed');
    expect(readGcode('G0 Z1\rM30\r').lineEnding).toBe('cr');
    expect(readGcode('M30').lineEnding).toBe('none');
  });

  it('invalid options are errors, not exceptions', () => {
    const r = readGcode('M30\n', {
      arcTolerance: Number.NaN,
      initialPosition: { x: Number.POSITIVE_INFINITY, y: 0, z: 0 },
      extraMCodes: [1.5],
      // @ts-expect-error -- deliberately invalid
      strict: 'no',
      // @ts-expect-error -- deliberately invalid
      dwellUnit: 'min',
    });
    expect(codes(r)).toEqual(Array(5).fill('INVALID_OPTION'));
  });

  it('snapshots can be turned off', () => {
    const r = readGcode('G0 Z1\nM30\n', { snapshots: false });
    expect(r.lines).toEqual([]);
    expect(r.finalState.position.z).toBe(1);
  });
});
