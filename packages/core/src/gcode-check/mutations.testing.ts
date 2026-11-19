/**
 * Mutation catalogue (T019): deliberately broken variants of a golden program, each with the rule
 * that must catch it. Line-based text edits on CRLF programs. Not exported from the package.
 */
import type { GcodeCheckRule } from './types';

export interface Mutation {
  id: string;
  rule: GcodeCheckRule;
  /** Expected code (optional: some mutations are caught by several codes of the rule). */
  code?: string;
  posts: readonly ('generic' | 'mach3')[];
  what: string;
  apply: (lines: string[]) => string[];
}

const BOTH = ['generic', 'mach3'] as const;

/** Index of the first line matching, or throws (a catalogue entry must change something). */
function find(lines: readonly string[], re: RegExp, from = 0): number {
  for (let i = from; i < lines.length; i++) if (re.test(lines[i] ?? '')) return i;
  throw new Error(`mutation anchor ${String(re)} not found`);
}

function findLast(lines: readonly string[], re: RegExp): number {
  for (let i = lines.length - 1; i >= 0; i--) if (re.test(lines[i] ?? '')) return i;
  throw new Error(`mutation anchor ${String(re)} not found`);
}

function edit(lines: string[], i: number, f: (l: string) => string): string[] {
  const out = [...lines];
  const before = out[i] ?? '';
  out[i] = f(before);
  if (out[i] === before) throw new Error(`mutation did not change line ${i + 1}: ${before}`);
  return out;
}

function remove(lines: string[], i: number): string[] {
  return lines.filter((_, k) => k !== i);
}

function insert(lines: string[], i: number, line: string): string[] {
  return [...lines.slice(0, i), line, ...lines.slice(i)];
}

/** A rapid that moves X and/or Y (unchanged axes are not written). */
const XY_RAPID = /^G0 (?=[XY])(X-?[\d.]+)? ?(Y-?[\d.]+)?$/;
const SAFE = /^G0 Z20\.0+$/;

/** Operation blocks: from an XY rapid at safe Z to the retract to safe Z after it. */
export function opBlocks(lines: readonly string[]): [number, number][] {
  const out: [number, number][] = [];
  let i = 0;
  for (;;) {
    let s = -1;
    for (let k = i; k < lines.length; k++)
      if (XY_RAPID.test(lines[k] ?? '')) {
        s = k;
        break;
      }
    if (s < 0) return out;
    let e = -1;
    for (let k = s + 1; k < lines.length; k++)
      if (SAFE.test(lines[k] ?? '')) {
        e = k;
        break;
      }
    if (e < 0) return out;
    out.push([s, e]);
    i = e + 1;
  }
}

/**
 * First operation block that cuts through (reaches the deepest Z of the program): the layout
 * mutations need a part or a through hole, not a blind hole (T140).
 */
function throughBlock(lines: readonly string[]): [number, number] | undefined {
  const zs = (l: string) => [...l.matchAll(/Z(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  const deepest = Math.min(...lines.flatMap(zs));
  return opBlocks(lines).find(([s, e]) =>
    lines.slice(s, e + 1).some((l) => zs(l).includes(deepest)),
  );
}

/** Adds `dx` to every absolute X word of lines [s, e] (I/J are incremental and unchanged). */
function shiftX(lines: string[], s: number, e: number, dx: number): string[] {
  return lines.map((l, k) =>
    k < s || k > e
      ? l
      : l.replace(/X(-?\d+\.\d+)/, (_, v: string) => {
          const dec = v.split('.')[1]?.length ?? 3;
          return `X${(Number(v) + dx).toFixed(dec)}`;
        }),
  );
}

/** Moves the centre of the first G2/G3 line by `d` along the chord's perpendicular bisector. */
function shiftArcCentre(lines: string[], d: number): string[] {
  const i = find(lines, /^G[23] X.* I.* J/);
  // Start point = last X and Y written before the arc.
  let sx = NaN;
  let sy = NaN;
  for (let k = 0; k < i; k++) {
    const l = lines[k] ?? '';
    if (l.startsWith('(')) continue;
    const x = /X(-?[\d.]+)/.exec(l);
    const y = /Y(-?[\d.]+)/.exec(l);
    if (x) sx = Number(x[1]);
    if (y) sy = Number(y[1]);
  }
  const l = lines[i] ?? '';
  const ex = Number(/X(-?[\d.]+)/.exec(l)?.[1] ?? sx);
  const ey = Number(/Y(-?[\d.]+)/.exec(l)?.[1] ?? sy);
  const len = Math.hypot(ex - sx, ey - sy);
  const nx = -(ey - sy) / len;
  const ny = (ex - sx) / len;
  return edit(lines, i, (t) =>
    t
      .replace(
        /I(-?[\d.]+)/,
        (_, v: string) => `I${(Number(v) + d * nx).toFixed(v.split('.')[1]?.length ?? 3)}`,
      )
      .replace(
        /J(-?[\d.]+)/,
        (_, v: string) => `J${(Number(v) + d * ny).toFixed(v.split('.')[1]?.length ?? 3)}`,
      ),
  );
}

export const MUTATIONS: readonly Mutation[] = [
  // R1 modal state
  {
    id: 'R1-no-G21',
    rule: 'R1',
    code: 'MODAL_NOT_EXPLICIT',
    posts: BOTH,
    what: 'delete G21',
    apply: (l) => edit(l, find(l, /^G21 /), (t) => t.replace('G21 ', '')),
  },
  {
    id: 'R1-no-G90',
    rule: 'R1',
    code: 'MODAL_NOT_EXPLICIT',
    posts: BOTH,
    what: 'delete G90',
    apply: (l) => edit(l, find(l, /^G21 /), (t) => t.replace(' G90', '')),
  },
  {
    id: 'R1-no-G17',
    rule: 'R1',
    code: 'MODAL_NOT_EXPLICIT',
    posts: BOTH,
    what: 'delete G17',
    apply: (l) => edit(l, find(l, /^G21 /), (t) => t.replace(' G17', '')),
  },
  {
    id: 'R1-no-G54',
    rule: 'R1',
    code: 'MODAL_NOT_EXPLICIT',
    posts: BOTH,
    what: 'delete G54',
    apply: (l) => edit(l, find(l, /^G21 /), (t) => t.replace(' G54', '')),
  },
  {
    id: 'R1-no-G91.1',
    rule: 'R1',
    code: 'MODAL_NOT_EXPLICIT',
    posts: ['mach3'],
    what: 'delete G91.1 (declared by the post)',
    apply: (l) => edit(l, find(l, /^G21 /), (t) => t.replace(' G91.1', '')),
  },
  {
    id: 'R1-G91-mid',
    rule: 'R1',
    code: 'MODAL_WRONG',
    posts: BOTH,
    what: 'insert G91 before a cut',
    apply: (l) => insert(l, find(l, /^G1 Z-/), 'G91'),
  },
  // R2 safe Z
  {
    id: 'R2-first-move-xy',
    rule: 'R2',
    code: 'FIRST_MOVE_NOT_SAFE_Z',
    posts: BOTH,
    what: 'first motion also moves XY',
    apply: (l) => edit(l, find(l, SAFE), () => 'G0 X10.000 Y10.000 Z20.000'),
  },
  {
    id: 'R2-first-move-low',
    rule: 'R2',
    code: 'FIRST_MOVE_NOT_SAFE_Z',
    posts: BOTH,
    what: 'first motion to Z5',
    apply: (l) => edit(l, find(l, SAFE), () => 'G0 Z5.000'),
  },
  {
    id: 'R2-xy-rapid-low',
    rule: 'R2',
    code: 'XY_RAPID_BELOW_SAFE_Z',
    posts: BOTH,
    what: 'XY rapid moved down to Z5',
    apply: (l) => edit(l, find(l, XY_RAPID), (t) => `${t} Z5.000`),
  },
  {
    id: 'R2-retract-low',
    rule: 'R2',
    code: 'XY_RAPID_BELOW_SAFE_Z',
    posts: BOTH,
    what: 'retract only to Z10, next XY rapid there',
    apply: (l) => {
      const r = l.findIndex(
        (t, i) => SAFE.test(t) && XY_RAPID.test(l[i + 1] ?? '') && i > find(l, /^G1 /),
      );
      return edit(l, r, () => 'G0 Z10.000');
    },
  },
  // R3 rapids and plunges
  {
    id: 'R3-plunge-as-rapid',
    rule: 'R3',
    code: 'RAPID_INTO_MATERIAL',
    posts: BOTH,
    what: 'G1 plunge replaced by G0',
    apply: (l) => edit(l, find(l, /^G1 Z-/), (t) => t.replace(/^G1 (Z-[\d.]+) F\d+$/, 'G0 $1')),
  },
  {
    id: 'R3-below-clearance',
    rule: 'R3',
    code: 'RAPID_BELOW_CLEARANCE',
    posts: BOTH,
    what: 'approach rapid to Z1 (clearance 2)',
    apply: (l) => edit(l, find(l, /^G0 Z2\.0+$/), () => 'G0 Z1.000'),
  },
  {
    id: 'R3-plunge-fast',
    rule: 'R3',
    code: 'PLUNGE_TOO_FAST',
    posts: BOTH,
    what: 'plunge at the cutting feed',
    apply: (l) => edit(l, find(l, /^G1 Z-.* F1500$/), (t) => t.replace('F1500', 'F6000')),
  },
  // R4 spindle
  {
    id: 'R4-no-M3',
    rule: 'R4',
    code: 'CUT_SPINDLE_OFF',
    posts: BOTH,
    what: 'delete M3',
    apply: (l) => remove(l, find(l, /^M3 S/)),
  },
  {
    id: 'R4-no-G4',
    rule: 'R4',
    code: 'WARMUP_MISSING',
    posts: BOTH,
    what: 'delete G4 warm-up',
    apply: (l) => remove(l, find(l, /^G4 /)),
  },
  {
    id: 'R4-short-G4',
    rule: 'R4',
    code: 'WARMUP_MISSING',
    posts: BOTH,
    what: 'warm-up 2 s instead of 5 s',
    apply: (l) => edit(l, find(l, /^G4 /), () => 'G4 P2.0'),
  },
  {
    id: 'R4-rpm-range',
    rule: 'R4',
    code: 'SPINDLE_RPM_RANGE',
    posts: BOTH,
    what: 'S30000 above the spindle maximum',
    apply: (l) => edit(l, find(l, /^M3 S/), () => 'M3 S30000'),
  },
  {
    id: 'R4-M5-mid',
    rule: 'R4',
    code: 'CUT_SPINDLE_OFF',
    posts: BOTH,
    what: 'M5 in the middle of a cut',
    apply: (l) => insert(l, find(l, /^G1 X/), 'M5'),
  },
  {
    id: 'R4-no-vacuum',
    rule: 'R4',
    code: 'VACUUM_NOT_ON',
    posts: BOTH,
    what: 'delete vacuum on (M7)',
    apply: (l) => remove(l, find(l, /^M7$/)),
  },
  // R5 feed
  {
    id: 'R5-first-F',
    rule: 'R5',
    code: 'FEED_UNDEFINED',
    posts: BOTH,
    what: 'drop the first F',
    apply: (l) => edit(l, find(l, /^G1 Z-.* F1500$/), (t) => t.replace(' F1500', '')),
  },
  {
    id: 'R5-F-after-rapid',
    rule: 'R5',
    code: 'FEED_NOT_EXPLICIT',
    posts: BOTH,
    what: "drop F of the second part's plunge",
    apply: (l) => {
      const s = opBlocks(l)[1]?.[0] ?? 0;
      return edit(l, find(l, /^G1 Z-.* F1500$/, s), (t) => t.replace(' F1500', ''));
    },
  },
  // R6 envelope
  {
    id: 'R6-X-beyond',
    rule: 'R6',
    code: 'OUT_OF_ENVELOPE',
    posts: BOTH,
    what: 'XY rapid to X3150 (travel 3100)',
    apply: (l) => edit(l, find(l, XY_RAPID), (t) => t.replace(/X-?[\d.]+/, 'X3150.000')),
  },
  {
    id: 'R6-X-negative',
    rule: 'R6',
    code: 'OUT_OF_ENVELOPE',
    posts: BOTH,
    what: 'XY rapid to X-5',
    apply: (l) => edit(l, find(l, XY_RAPID), (t) => t.replace(/X-?[\d.]+/, 'X-5.000')),
  },
  {
    id: 'R6-too-deep',
    rule: 'R6',
    code: 'BELOW_SPOILBOARD_ALLOWANCE',
    posts: BOTH,
    what: 'final pass Z-19.5 (allowance 0.5)',
    apply: (l) => edit(l, find(l, /^G1 Z-18\.50*( |$)/), (t) => t.replace(/Z-18\.50*/, 'Z-19.500')),
  },
  {
    id: 'R6-Z-travel',
    rule: 'R6',
    code: 'OUT_OF_ENVELOPE',
    posts: BOTH,
    what: 'retract to Z200 (Z travel 150)',
    apply: (l) => edit(l, opBlocks(l)[0]?.[1] ?? -1, () => 'G0 Z200.000'),
  },
  // R7 end sequence
  {
    id: 'R7-no-M5',
    rule: 'R7',
    code: 'END_SPINDLE_ON',
    posts: BOTH,
    what: 'delete M5',
    apply: (l) => remove(l, findLast(l, /^M5$/)),
  },
  {
    id: 'R7-no-M30',
    rule: 'R7',
    code: 'END_CODE_MISSING',
    posts: BOTH,
    what: 'delete M30',
    apply: (l) => remove(l, findLast(l, /^M30$/)),
  },
  {
    id: 'R7-no-M9',
    rule: 'R7',
    code: 'END_VACUUM_ON',
    posts: BOTH,
    what: 'delete vacuum off (M9)',
    apply: (l) => remove(l, findLast(l, /^M9$/)),
  },
  {
    id: 'R7-no-retract',
    rule: 'R7',
    code: 'END_NOT_AT_SAFE_Z',
    posts: BOTH,
    what: 'delete the last retract to safe Z',
    apply: (l) => remove(l, findLast(l, SAFE)),
  },
  {
    id: 'R7-code-after-end',
    rule: 'R7',
    code: 'CODE_AFTER_END',
    posts: BOTH,
    what: 'motion after M30',
    apply: (l) => insert(l, findLast(l, /^M30$/) + 1, 'G0 X0.000 Y0.000'),
  },
  // R8 numbers
  {
    id: 'R8-exponent',
    rule: 'R8',
    code: 'NUMBER_FORMAT',
    posts: BOTH,
    what: 'insert 1e3 (F6e3)',
    apply: (l) => edit(l, find(l, /F6000$/), (t) => t.replace('F6000', 'F6e3')),
  },
  {
    id: 'R8-exponent-X',
    rule: 'R8',
    code: 'NUMBER_FORMAT',
    posts: BOTH,
    what: 'X written as 1e3',
    apply: (l) => edit(l, find(l, /^G1 X/), (t) => t.replace(/X-?[\d.]+/, 'X1e3')),
  },
  {
    id: 'R8-NaN',
    rule: 'R8',
    code: 'NUMBER_FORMAT',
    posts: BOTH,
    what: 'X written as NaN',
    apply: (l) => edit(l, find(l, /^G1 X/), (t) => t.replace(/X-?[\d.]+/, 'XNaN')),
  },
  {
    id: 'R8-empty',
    rule: 'R8',
    code: 'NUMBER_FORMAT',
    posts: BOTH,
    what: 'empty Y value',
    apply: (l) => edit(l, find(l, /^G1 Y/), (t) => t.replace(/Y-?[\d.]+/, 'Y')),
  },
  // R9 reader errors
  {
    id: 'R9-unknown-word',
    rule: 'R9',
    code: 'UNKNOWN_WORD',
    posts: BOTH,
    what: 'unknown word A5 on a cut',
    apply: (l) => edit(l, find(l, /^G1 X/), (t) => `${t} A5`),
  },
  {
    id: 'R9-unknown-M',
    rule: 'R9',
    code: 'UNKNOWN_WORD',
    posts: BOTH,
    what: 'unknown M code M10',
    apply: (l) => insert(l, find(l, /^M3 S/), 'M10'),
  },
  {
    id: 'R9-unsupported',
    rule: 'R9',
    code: 'UNSUPPORTED_CODE',
    posts: BOTH,
    what: 'G28 home move',
    apply: (l) => insert(l, findLast(l, /^M5$/), 'G28'),
  },
  {
    id: 'R9-block-delete',
    rule: 'R9',
    code: 'BLOCK_DELETE',
    posts: BOTH,
    what: 'block delete on a cut',
    apply: (l) => edit(l, find(l, /^G1 X/), (t) => `/${t}`),
  },
  // R10 header
  {
    id: 'R10-no-header',
    rule: 'R10',
    code: 'UNVERIFIED_HEADER_MISSING',
    posts: BOTH,
    what: 'remove the unverified header',
    apply: (l) => remove(l, 0),
  },
  {
    id: 'R10-header-late',
    rule: 'R10',
    code: 'UNVERIFIED_HEADER_MISSING',
    posts: BOTH,
    what: 'unverified header not first',
    apply: (l) => [l[1] ?? '', l[0] ?? '', ...l.slice(2)],
  },
  // MODEL
  {
    id: 'M-arc-centre',
    rule: 'MODEL',
    code: 'MODEL_MISMATCH',
    posts: BOTH,
    what: 'arc centre shifted 0.05 (radii still equal)',
    apply: (l) => shiftArcCentre(l, 0.05),
  },
  {
    id: 'M-arc-direction',
    rule: 'MODEL',
    code: 'MODEL_MISMATCH',
    posts: BOTH,
    what: 'G2/G3 direction flipped',
    apply: (l) =>
      edit(l, find(l, /^G[23] /), (t) =>
        t.replace(/^G([23])/, (_, d: string) => (d === '2' ? 'G3' : 'G2')),
      ),
  },
  {
    id: 'M-feed',
    rule: 'MODEL',
    code: 'MODEL_MISMATCH',
    posts: BOTH,
    what: 'cutting feed F6000 → F7000',
    apply: (l) => edit(l, find(l, /F6000$/), (t) => t.replace('F6000', 'F7000')),
  },
  {
    id: 'M-swap-parts',
    rule: 'MODEL',
    code: 'MODEL_MISMATCH',
    posts: BOTH,
    what: 'swap two parts (cut order)',
    apply: (l) => {
      const [a, b] = opBlocks(l);
      if (!a || !b) throw new Error('two blocks needed');
      return [
        ...l.slice(0, a[0]),
        ...l.slice(b[0], b[1] + 1),
        ...l.slice(a[0], a[1] + 1),
        ...l.slice(b[1] + 1),
      ];
    },
  },
  {
    id: 'M-endpoint',
    rule: 'MODEL',
    code: 'MODEL_MISMATCH',
    posts: BOTH,
    what: 'one contour end point 0.1 mm off',
    apply: (l) =>
      edit(l, find(l, /^G1 X[\d.]+$/), (t) =>
        t.replace(
          /X([\d.]+)/,
          (_, v: string) => `X${(Number(v) + 0.1).toFixed(v.split('.')[1]?.length ?? 3)}`,
        ),
      ),
  },
  {
    id: 'M-rpm',
    rule: 'MODEL',
    code: 'RPM_MISMATCH',
    posts: BOTH,
    what: 'S17000 instead of S18000 (in range)',
    apply: (l) => edit(l, find(l, /^M3 S/), () => 'M3 S17000'),
  },
  // LAYOUT
  {
    id: 'L-drop-part',
    rule: 'LAYOUT',
    code: 'PART_COUNT',
    posts: BOTH,
    what: 'delete one part',
    apply: (l) => {
      const a = throughBlock(l);
      if (!a) throw new Error('block');
      return [...l.slice(0, a[0]), ...l.slice(a[1] + 1)];
    },
  },
  {
    id: 'L-move-part',
    rule: 'LAYOUT',
    code: 'PART_POSITION',
    posts: BOTH,
    what: 'one part moved 3 mm in X',
    apply: (l) => {
      const a = throughBlock(l);
      if (!a) throw new Error('block');
      return shiftX(l, a[0], a[1], 3);
    },
  },
  {
    id: 'L-extra-part',
    rule: 'LAYOUT',
    code: 'PART_COUNT',
    posts: BOTH,
    what: 'one part cut twice',
    apply: (l) => {
      const a = throughBlock(l);
      if (!a) throw new Error('block');
      return [...l.slice(0, a[1] + 1), ...l.slice(a[0], a[1] + 1), ...l.slice(a[1] + 1)];
    },
  },
  // TOOLS
  {
    id: 'T-T2-to-T3',
    rule: 'TOOLS',
    code: 'TOOL_NOT_IN_PROFILE',
    posts: ['generic'],
    what: 'T2 M6 → T3 M6 (T3 not in the profile)',
    apply: (l) => edit(l, find(l, /^T2 M6$/), () => 'T3 M6'),
  },
  {
    id: 'T-T2-to-T1',
    rule: 'TOOLS',
    code: 'TOOL_ORDER',
    posts: ['generic'],
    what: 'T2 M6 → T1 M6 (wrong tool)',
    apply: (l) => edit(l, find(l, /^T2 M6$/), () => 'T1 M6'),
  },
  {
    id: 'T-no-M6',
    rule: 'TOOLS',
    code: 'TOOL_ORDER',
    posts: ['generic'],
    what: 'delete the tool change',
    apply: (l) => remove(l, find(l, /^T2 M6$/)),
  },
  {
    id: 'T-prompt-T3',
    rule: 'TOOLS',
    code: 'TOOL_PROMPT_MISMATCH',
    posts: ['mach3'],
    what: 'operator prompt names T3',
    apply: (l) => edit(l, find(l, /^\(TAKIM T2 /), (t) => t.replace('T2', 'T3')),
  },
  {
    id: 'T-no-M0',
    rule: 'TOOLS',
    code: 'TOOL_PAUSE_COUNT',
    posts: ['mach3'],
    what: 'delete the tool pause (M0)',
    apply: (l) => remove(l, find(l, /^M0$/)),
  },
];
