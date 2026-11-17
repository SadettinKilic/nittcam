/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known results */
/**
 * Cross-check of the independent G-code reader (T018, D-026) against a second, minimal modal
 * parser written by the tester (the T017 reader idea, reduced to what the comparison needs).
 * Both see only the emitted TEXT. They must agree on every endpoint, arc centre, feed, spindle
 * state and tool, on the six golden files and on generated programs (toolpath -> generator, both
 * posts, 4 corners, 2 Z references). The new reader must report 0 errors and 0 warnings.
 * The generator is imported only to produce programs, never by the reader.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import genericPost from '../../../machines/generic/v1/post.json';
import mach3Post from '../../../machines/mach3/v1/post.json';
import { readGcode, type GcodeMove } from '../gcode-reader';
import { defaultMachineProfile, type MachineProfile } from '../machine';
import { nestProject } from '../nesting';
import type { Project } from '../schema';
import { buildToolpath, type Toolpath, type ToolpathOptions } from '../toolpath';
import { projectOf } from '../toolpath/toolpath.testing';
import { generateGcode } from './generate';

const MACHINES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../machines');

type PostId = 'generic' | 'mach3';
const POSTS: Record<PostId, { json: typeof genericPost }> = {
  generic: { json: genericPost },
  mach3: { json: mach3Post as unknown as typeof genericPost },
};

// ---------------------------------------------------------------------------
// Tester's minimal modal parser (no code shared with src/gcode-reader)
// ---------------------------------------------------------------------------

interface RefMove {
  kind: 'G0' | 'G1' | 'G2' | 'G3';
  to: { x: number; y: number; z: number };
  centre?: { x: number; y: number };
  f: number | null;
  spindleOn: boolean;
  rpm: number | null;
  tool: number | null;
  line: number;
}

function refParse(text: string): RefMove[] {
  const out: RefMove[] = [];
  let motion: RefMove['kind'] | null = null;
  let pos = { x: 0, y: 0, z: 0 };
  let f: number | null = null;
  let rpm: number | null = null;
  let spindleOn = false;
  let selected: number | null = null;
  let tool: number | null = null;
  text.split(/\r\n|\n|\r/).forEach((raw, idx) => {
    const code = raw
      .replace(/\([^)]*\)/g, '')
      .replace(/;.*$/, '')
      .trim();
    if (code === '' || code === '%') return;
    const g: number[] = [];
    const m: number[] = [];
    const a = new Map<string, number>();
    for (const w of code.split(/\s+/)) {
      const letter = w[0]!.toUpperCase();
      const n = Number(w.slice(1));
      if (letter === 'N' || letter === 'O') continue;
      if (letter === 'G') g.push(n);
      else if (letter === 'M') m.push(n);
      else a.set(letter, n);
    }
    if (a.has('F')) f = a.get('F')!;
    if (a.has('S')) rpm = a.get('S')!;
    if (a.has('T')) selected = a.get('T')!;
    if (m.includes(6)) tool = selected;
    if (m.includes(3)) spindleOn = true;
    if (m.includes(5) || m.includes(30)) spindleOn = false;
    for (const c of g) {
      if (c === 0) motion = 'G0';
      if (c === 1) motion = 'G1';
      if (c === 2) motion = 'G2';
      if (c === 3) motion = 'G3';
    }
    const axis = a.has('X') || a.has('Y') || a.has('Z');
    if (!axis || motion === null) return;
    const from = pos;
    pos = {
      x: a.has('X') ? a.get('X')! : from.x,
      y: a.has('Y') ? a.get('Y')! : from.y,
      z: a.has('Z') ? a.get('Z')! : from.z,
    };
    const mv: RefMove = {
      kind: motion,
      to: pos,
      f: motion === 'G0' ? null : f,
      spindleOn,
      rpm,
      tool,
      line: idx + 1,
    };
    // the generator writes G91.1 (incremental I/J) for both posts
    if (motion === 'G2' || motion === 'G3') {
      mv.centre = { x: from.x + (a.get('I') ?? 0), y: from.y + (a.get('J') ?? 0) };
    }
    out.push(mv);
  });
  return out;
}

const KIND_OF: Record<GcodeMove['type'], RefMove['kind']> = {
  rapid: 'G0',
  feed: 'G1',
  arcCw: 'G2',
  arcCcw: 'G3',
};

/** Compare both readers on one program text; returns the number of moves compared. */
function compareReaders(text: string, label: string): { moves: number; arcs: number } {
  const r = readGcode(text);
  expect(r.errors, `${label}: reader errors`).toEqual([]);
  expect(r.warnings, `${label}: reader warnings`).toEqual([]);
  const ref = refParse(text);
  expect(r.moves.length, `${label}: move count`).toBe(ref.length);
  let arcs = 0;
  r.moves.forEach((mv, i) => {
    const e = ref[i]!;
    const at = `${label} line ${e.line} (move ${i})`;
    expect(mv.line, at).toBe(e.line);
    expect(KIND_OF[mv.type], at).toBe(e.kind);
    expect(mv.to.x, `${at} x`).toBeCloseTo(e.to.x, 9);
    expect(mv.to.y, `${at} y`).toBeCloseTo(e.to.y, 9);
    expect(mv.to.z, `${at} z`).toBeCloseTo(e.to.z, 9);
    expect(mv.feed, `${at} feed`).toBe(e.f);
    expect(mv.spindleOn, `${at} spindle`).toBe(e.spindleOn);
    expect(mv.rpm, `${at} rpm`).toBe(e.rpm);
    expect(mv.tool, `${at} tool`).toBe(e.tool);
    if (e.centre) {
      arcs++;
      expect(mv.arc, `${at} arc`).toBeDefined();
      expect(mv.arc!.cx, `${at} cx`).toBeCloseTo(e.centre.x, 9);
      expect(mv.arc!.cy, `${at} cy`).toBeCloseTo(e.centre.y, 9);
      expect(mv.arc!.direction).toBe(e.kind === 'G2' ? 'cw' : 'ccw');
    } else {
      expect(mv.arc, `${at} arc`).toBeUndefined();
    }
    for (const v of [mv.from.x, mv.from.y, mv.from.z, mv.to.x, mv.to.y, mv.to.z]) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
  return { moves: ref.length, arcs };
}

// ---------------------------------------------------------------------------
// Golden files
// ---------------------------------------------------------------------------

const GOLDEN = [
  'generic/v1/golden/cabinet-doors_S1.nc',
  'generic/v1/golden/mixed_S1.nc',
  'generic/v1/golden/shelf-set_S1.nc',
  'mach3/v1/golden/cabinet-doors_S1.tap',
  'mach3/v1/golden/mixed_S1.tap',
  'mach3/v1/golden/shelf-set_S1.tap',
] as const;

describe('T018 cross-check: both readers agree on the golden files', () => {
  it.each(GOLDEN)('%s', (rel) => {
    const text = readFileSync(join(MACHINES, rel), 'latin1');
    const n = compareReaders(text, rel);
    expect(n.moves).toBeGreaterThan(100);
    const r = readGcode(text);
    expect(r.ok).toBe(true);
    expect(r.finalState.spindle).toBe('off');
    expect(r.events.some((e) => e.kind === 'end')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Generated programs (scenario generators copied from post.safety.tester.test.ts)
// ---------------------------------------------------------------------------

const CORNERS = ['frontLeft', 'frontRight', 'backLeft', 'backRight'] as const;
const NATURAL = {
  frontLeft: { x: 'right', y: 'back' },
  frontRight: { x: 'left', y: 'back' },
  backLeft: { x: 'right', y: 'front' },
  backRight: { x: 'left', y: 'front' },
} as const;

interface Scn {
  post: PostId;
  corner: (typeof CORNERS)[number];
  away: boolean;
  zRef: 'table' | 'materialTop';
  offset: { x: number; y: number };
  warmup: number;
  safeZ: number;
  clearance: number;
  spoil: number;
  thickness: number;
  toolDia: number;
  toolNo: number;
  feed: number;
  plunge: number;
  stepDown: number;
  lead: 'arc' | 'line' | 'none';
  plungeKind: NonNullable<ToolpathOptions['plunge']>;
  direction: 'climb' | 'conventional';
  tabs: boolean;
  sheet: { width: number; height: number };
  parts: { id: string; w: number; h: number; r: number; qty: number }[];
}

function profileOf(
  s: Pick<
    Scn,
    | 'post'
    | 'corner'
    | 'away'
    | 'zRef'
    | 'offset'
    | 'warmup'
    | 'safeZ'
    | 'spoil'
    | 'thickness'
    | 'toolDia'
    | 'toolNo'
    | 'feed'
    | 'plunge'
    | 'stepDown'
  >,
): MachineProfile {
  const p = defaultMachineProfile();
  p.workEnvelope = { x: 3100, y: 2200, z: 150 };
  p.table = { width: 3050, depth: 2150 };
  const nat = NATURAL[s.corner];
  p.origin = {
    corner: s.corner,
    xPositive: s.away ? (nat.x === 'right' ? 'left' : 'right') : nat.x,
    yPositive: s.away ? (nat.y === 'back' ? 'front' : 'back') : nat.y,
    sheetOffset: s.offset,
  };
  p.zZero = { reference: s.zRef, spoilboardAllowance: s.spoil };
  p.safeZ = s.safeZ;
  p.spindle = { ...p.spindle, warmupSeconds: s.warmup };
  p.post = { id: s.post, version: '1.0.0' };
  p.toolChanger =
    s.post === 'generic'
      ? { type: 'auto', capacity: 8, lengthCompensation: false }
      : { type: 'manual', capacity: 1, lengthCompensation: false };
  p.tools = [
    { number: s.toolNo, type: 'flatEndMill', diameter: s.toolDia, fluteLength: 40, flutes: 2 },
  ];
  p.materials = [
    {
      material: 'mdf',
      thickness: s.thickness,
      feed: s.feed,
      plungeFeed: s.plunge,
      rpm: 18000,
      stepDown: s.stepDown,
      tool: s.toolNo,
    },
  ];
  return p;
}

function build(s: Scn) {
  const profile = profileOf(s);
  const unplaced = projectOf({
    parts: s.parts,
    sheet: s.sheet,
    thickness: s.thickness,
    gap: 4,
    margin: 10,
    leadIn: s.lead === 'line' ? 'line' : 'arc',
    direction: s.direction,
  });
  const nested = nestProject(unplaced, { toolDiameter: s.toolDia });
  const project: Project = {
    ...unplaced,
    layout: nested.layout,
    cutting: { ...unplaced.cutting, tabs: { ...unplaced.cutting.tabs, auto: s.tabs } },
  };
  const options: ToolpathOptions = {
    lead: s.lead,
    plunge: s.plungeKind,
    direction: s.direction,
    clearance: s.clearance,
  };
  const tp = buildToolpath(project, profile, options);
  return { profile, project, tp, placed: nested.layout.sheets.length > 0 };
}

function gen(
  s: Scn,
  profile: MachineProfile,
  toolpath: Toolpath,
  post: unknown = POSTS[s.post].json,
) {
  return generateGcode(
    toolpath,
    { profile, version: 1, verification: 'draft' },
    post,
    {
      projectName: 'Guvenlik denemesi',
      revision: 1,
      fileStem: 'guvenlik',
      stock: {
        material: 'mdf',
        thickness: s.thickness,
        sheetWidth: s.sheet.width,
        sheetHeight: s.sheet.height,
      },
    },
    {},
  );
}

const partArb = (i: number) =>
  fc
    .record({
      w: fc.double({ min: 40, max: 700, noNaN: true }),
      h: fc.double({ min: 40, max: 500, noNaN: true }),
      rFrac: fc.oneof(fc.constant(0), fc.double({ min: 0, max: 0.5, noNaN: true })),
      qty: fc.integer({ min: 1, max: 2 }),
    })
    .map(({ w, h, rFrac, qty }) => ({ id: `p${i}`, w, h, r: (rFrac * Math.min(w, h)) / 2, qty }));

const scnArb: fc.Arbitrary<Scn> = fc.record({
  post: fc.constantFrom<PostId>('generic', 'mach3'),
  corner: fc.constantFrom(...CORNERS),
  away: fc.oneof(fc.constant(false), fc.constant(false), fc.constant(false), fc.boolean()),
  zRef: fc.constantFrom('table' as const, 'materialTop' as const),
  offset: fc.record({
    x: fc.double({ min: 0, max: 200, noNaN: true }),
    y: fc.double({ min: 0, max: 200, noNaN: true }),
  }),
  warmup: fc.oneof(fc.constant(0), fc.constant(5), fc.double({ min: 0.05, max: 30, noNaN: true })),
  safeZ: fc.double({ min: 8, max: 60, noNaN: true }),
  clearance: fc.double({ min: 1, max: 6, noNaN: true }),
  spoil: fc.double({ min: 0, max: 2, noNaN: true }),
  thickness: fc.double({ min: 3, max: 30, noNaN: true }),
  toolDia: fc.constantFrom(3, 6, 8, 12),
  toolNo: fc.integer({ min: 1, max: 8 }),
  feed: fc.double({ min: 1000, max: 15000, noNaN: true }),
  plunge: fc.double({ min: 200, max: 1000, noNaN: true }),
  stepDown: fc.double({ min: 1.5, max: 20, noNaN: true }),
  lead: fc.constantFrom('arc' as const, 'line' as const, 'none' as const),
  plungeKind: fc.oneof(
    fc.constant({ type: 'straight' as const }),
    fc
      .double({ min: 2, max: 25, noNaN: true })
      .map((angleDeg) => ({ type: 'ramp' as const, angleDeg })),
  ),
  direction: fc.constantFrom('climb' as const, 'conventional' as const),
  tabs: fc.boolean(),
  sheet: fc.record({
    width: fc.double({ min: 800, max: 2440, noNaN: true }),
    height: fc.double({ min: 500, max: 1220, noNaN: true }),
  }),
  parts: fc
    .integer({ min: 1, max: 4 })
    .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => partArb(i)))),
});

describe('T018 cross-check: both readers agree on generated programs', () => {
  it('endpoints, arc centres, feed, spindle and tool agree; the reader reports no issue', () => {
    let programs = 0;
    let moves = 0;
    let arcs = 0;
    fc.assert(
      fc.property(scnArb, (s) => {
        const { profile, tp, placed } = build(s);
        fc.pre(placed && tp.ok);
        const res = gen(s, profile, tp.toolpath);
        expect(res.ok).toBe(true);
        for (const file of res.files) {
          programs++;
          const c = compareReaders(file.content, file.name);
          moves += c.moves;
          arcs += c.arcs;
        }
      }),
      { numRuns: Number(process.env.FC_RUNS ?? 500) },
    );
    expect(programs).toBeGreaterThanOrEqual(500);
    expect(moves).toBeGreaterThan(10_000);
    expect(arcs).toBeGreaterThan(100);
  }, 900_000);
});
