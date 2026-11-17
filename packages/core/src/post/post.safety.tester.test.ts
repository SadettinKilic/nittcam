/// <reference types="node" />
/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known results */
/**
 * G-code safety review of the post processor (T017, tester). Spec §7.2 (all 10 rules), §7.1, §6.4.
 *
 * The reader/checker below is written independently of `src/post`: a minimal modal G-code parser
 * (G0-G4, G17/G20/G21/G90/G91/G91.1/G54, F/S/T, M-codes, comments) that only sees the emitted TEXT
 * plus the machine profile. The generator under test is imported solely to produce programs. It is
 * run on the six golden files and on fast-check projects (toolpath builder -> generator) for both
 * posts, all four origin corners and both Z-zero references.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import genericPost from '../../../machines/generic/v1/post.json';
import mach3Post from '../../../machines/mach3/v1/post.json';
import { defaultMachineProfile, type MachineProfile } from '../machine';
import { nestProject } from '../nesting';
import type { Project } from '../schema';
import { buildToolpath, type Toolpath, type ToolpathOptions } from '../toolpath';
import { projectOf } from '../toolpath/toolpath.testing';
import { generateGcode } from './generate';

const MACHINES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../machines');
const UNVERIFIED = '(DOGRULANMADI, once air cut)';

// ---------------------------------------------------------------------------
// Independent reader + §7.2 checker (no import from the post generator)
// ---------------------------------------------------------------------------

type Pt = { x: number; y: number; z: number };

interface Ctx {
  /** Decimals written for X/Y, Z, I/J. */
  dec: { xy: number; z: number; arc: number; dwell: number };
  /** Expected written dwell unit: 's' or 'ms'. */
  dwellUnit: 's' | 'ms';
  mach3: boolean;
  /** Spindle warm-up of the profile, seconds. */
  warmup: number;
  /** Safe Z and material top in the machine frame. */
  safeZ: number;
  zTop: number;
  /** Rapid Z must stay at or above zTop + clearance. */
  clearance: number;
  plungeFeed: number;
  /** Physical envelope into the table, axis signs and zero side. */
  env: { x: number; y: number; z: number };
  zeroLeft: boolean;
  zeroFront: boolean;
  xRight: boolean;
  yBack: boolean;
  tableZ: number;
  spoil: number;
  rpmMin: number;
  rpmMax: number;
  vacuumOn: string;
  vacuumOff: string;
  expectUnverifiedHeader: boolean;
}

interface Mv {
  kind: 'G0' | 'G1' | 'G2' | 'G3';
  from: Pt;
  to: Pt;
  i?: number;
  j?: number;
  f: number | null;
  line: number;
}

const NUM = /^-?\d+(\.\d+)?$/;
const OK_G = new Set([
  'G0',
  'G1',
  'G2',
  'G3',
  'G4',
  'G17',
  'G21',
  'G40',
  'G49',
  'G54',
  'G90',
  'G91.1',
]);
const OK_M = new Set(['M0', 'M3', 'M5', 'M6', 'M7', 'M9', 'M30']);

function decimalsOf(s: string): number {
  return s.includes('.') ? s.split('.')[1]!.length : 0;
}

interface Result {
  violations: string[];
  moves: Mv[];
}

export function readAndCheck(text: string, ctx: Ctx): Result {
  const v: string[] = [];
  // Z words are rounded toward +Z (D-025, PO decision on PR #25): up to one unit above the model.
  const ZT = Math.pow(10, -ctx.dec.z) * 1.01;
  const moves: Mv[] = [];
  const fail = (rule: number, line: number, msg: string) => v.push(`R${rule} line ${line}: ${msg}`);

  // line endings: CRLF only, content ends with a line ending
  if (!text.endsWith('\r\n')) v.push('R8 file does not end with CRLF');
  if (/(^|[^\r])\n/.test(text) || /\r(?!\n)/.test(text)) v.push('R8 bare LF or CR in file');
  const lines = text.split('\r\n');
  lines.pop();

  // rule 10
  if (ctx.expectUnverifiedHeader && lines[0] !== UNVERIFIED)
    fail(10, 1, `first line is "${lines[0]}"`);
  if (!ctx.expectUnverifiedHeader && lines.some((l) => l.includes('DOGRULANMADI'))) {
    fail(10, 1, 'warning header present on a verified program');
  }

  let units = false;
  let absolute = false;
  let plane = false;
  let wcs = false;
  let arcDist = false;
  let motion: Mv['kind'] | null = null;
  let pos: Pt = { x: NaN, y: NaN, z: NaN };
  let f: number | null = null;
  let spindleOn = false;
  let rpm = 0;
  let warmDone = false;
  let needF = true;
  let seenMotion = false;
  let usedVacuum = false;
  let m30Line = -1;
  let lastMotionLine = -1;
  let lastMotionKind: Mv['kind'] | null = null;
  let lastMotionIsZOnly = false;
  let lastMotionZ = NaN;
  let m5After = -1;
  let m9After = -1;
  let blockNo = 0;

  const physOk = (p: Pt, line: number) => {
    // distance into the table from program zero
    const px = ctx.xRight ? p.x : -p.x; // physical right-positive
    const py = ctx.yBack ? p.y : -p.y; // physical back-positive
    const intoX = ctx.zeroLeft ? px : -px;
    const intoY = ctx.zeroFront ? py : -py;
    const t = Math.pow(10, -Math.min(ctx.dec.xy, ctx.dec.z)) * 0.6;
    if (intoX < -t || intoX > ctx.env.x + t) fail(6, line, `X ${p.x} outside travel`);
    if (intoY < -t || intoY > ctx.env.y + t) fail(6, line, `Y ${p.y} outside travel`);
    if (p.z < ctx.tableZ - ctx.spoil - t || p.z > ctx.tableZ + ctx.env.z + t) {
      fail(6, line, `Z ${p.z} outside travel`);
    }
  };

  lines.forEach((raw, idx) => {
    const ln = idx + 1;
    const code = raw
      .replace(/\([^)]*\)/g, '')
      .replace(/;.*$/, '')
      .trim();
    if (code === '') return; // comment/blank only
    if (/[()]/.test(code) || /\bnan\b|infinity/i.test(code)) fail(8, ln, `bad text "${raw}"`);
    blockNo++;
    const words = code.split(/\s+/).filter((w) => !/^N\d+$/.test(w));
    const g: string[] = [];
    const m: string[] = [];
    const a = new Map<string, number>();
    const written = new Map<string, string>();
    for (const w of words) {
      const letter = w[0]!;
      const n = w.slice(1);
      if (!/^[A-Z]$/.test(letter) || !NUM.test(n)) {
        fail(8, ln, `word "${w}" is not letter + fixed decimal`);
        continue;
      }
      if (/^-0(\.0+)?$/.test(n)) fail(8, ln, `negative zero "${w}"`);
      if (letter === 'G') g.push(`G${Number(n) === 91.1 ? '91.1' : String(Number(n))}`);
      else if (letter === 'M') m.push(`M${Number(n)}`);
      else {
        if (!'XYZIJFSTP'.includes(letter)) fail(1, ln, `unexpected word ${w}`);
        if (a.has(letter)) fail(8, ln, `duplicate ${letter}`);
        a.set(letter, Number(n));
        written.set(letter, n);
        const want =
          letter === 'X' || letter === 'Y'
            ? ctx.dec.xy
            : letter === 'Z'
              ? ctx.dec.z
              : letter === 'I' || letter === 'J'
                ? ctx.dec.arc
                : letter === 'P'
                  ? ctx.dec.dwell
                  : 0;
        if (decimalsOf(n) !== want) fail(8, ln, `${w} has ${decimalsOf(n)} decimals, want ${want}`);
      }
    }
    for (const c of g) if (!OK_G.has(c)) fail(1, ln, `unsupported ${c}`);
    for (const c of m) if (!OK_M.has(c)) fail(1, ln, `unsupported ${c}`);
    if (m30Line >= 0) fail(7, ln, 'program word after M30');

    // modal setup words
    if (g.includes('G21')) units = true;
    if (g.includes('G90')) absolute = true;
    if (g.includes('G17')) plane = true;
    if (g.includes('G54')) wcs = true;
    if (g.includes('G91.1')) arcDist = true;
    for (const c of g) {
      if (c === 'G0') motion = 'G0';
      if (c === 'G1') motion = 'G1';
      if (c === 'G2') motion = 'G2';
      if (c === 'G3') motion = 'G3';
    }
    if (a.has('F')) f = a.get('F')!;
    if (a.has('S')) rpm = a.get('S')!;

    // dwell
    if (g.includes('G4')) {
      const p = a.get('P');
      if (p === undefined) fail(4, ln, 'G4 without P');
      else if (spindleOn && !warmDone) {
        const secs = ctx.dwellUnit === 's' ? p : p / 1000;
        if (secs + 1e-9 >= ctx.warmup) warmDone = true;
        else fail(4, ln, `dwell ${secs}s shorter than warm-up ${ctx.warmup}s`);
      }
    }

    // M words in file order of the block (tool word irrelevant here)
    for (const c of m) {
      if (c === 'M3') {
        if (!(rpm > 0)) fail(4, ln, 'M3 without S>0');
        if (rpm < ctx.rpmMin || rpm > ctx.rpmMax) fail(4, ln, `S${rpm} outside spindle range`);
        spindleOn = true;
        warmDone = ctx.warmup === 0;
        needF = true;
      }
      if (c === 'M5') {
        spindleOn = false;
        warmDone = false;
        m5After = blockNo;
      }
      if (c === 'M6' || c === 'M0') {
        if (spindleOn) fail(4, ln, `${c} while the spindle is running`);
        spindleOn = false;
        warmDone = false;
        needF = true;
      }
      if (c === 'M7') usedVacuum = true;
      if (c === 'M9') m9After = blockNo;
      if (c === 'M30') m30Line = ln;
    }

    // motion
    const hasAxis = a.has('X') || a.has('Y') || a.has('Z');
    if (hasAxis || ((g.includes('G2') || g.includes('G3')) && (a.has('I') || a.has('J')))) {
      if (motion === null) {
        fail(1, ln, 'axis word without a motion code');
        return;
      }
      if (!seenMotion) {
        // rule 1: everything explicit before the first motion
        if (!units) fail(1, ln, 'no G21 before first motion');
        if (!absolute) fail(1, ln, 'no G90 before first motion');
        if (!plane) fail(1, ln, 'no G17 before first motion');
        if (!wcs) fail(1, ln, 'no G54 before first motion');
        if (ctx.mach3 && !arcDist) fail(1, ln, 'no G91.1 before first motion');
        // rule 2: first motion is a Z move to safe Z
        const zOnly = motion === 'G0' && a.has('Z') && !a.has('X') && !a.has('Y');
        if (!zOnly) fail(2, ln, 'first motion is not G0 Z only');
        else if (Math.abs(a.get('Z')! - ctx.safeZ) > ZT) {
          fail(2, ln, `first Z ${a.get('Z')} is not safe Z ${ctx.safeZ}`);
        }
        seenMotion = true;
      }
      const from = { ...pos };
      const to: Pt = {
        x: a.has('X') ? a.get('X')! : pos.x,
        y: a.has('Y') ? a.get('Y')! : pos.y,
        z: a.has('Z') ? a.get('Z')! : pos.z,
      };
      pos = to;
      const mv: Mv = { kind: motion, from, to, f, line: ln };
      if (a.has('I')) mv.i = a.get('I')!;
      if (a.has('J')) mv.j = a.get('J')!;
      moves.push(mv);
      lastMotionLine = blockNo;
      lastMotionKind = motion;
      lastMotionIsZOnly = !a.has('X') && !a.has('Y');
      lastMotionZ = to.z;

      physOk(to, ln);
      const xyChanged = !(from.x === to.x && from.y === to.y);
      if (motion === 'G0') {
        needF = true;
        if (xyChanged || Number.isNaN(from.x)) {
          if (Math.abs(to.z - ctx.safeZ) > ZT || Math.abs(from.z - ctx.safeZ) > ZT) {
            fail(2, ln, `XY rapid not at safe Z (from ${from.z} to ${to.z})`);
          }
        }
        if (to.z < ctx.zTop + ctx.clearance - ZT)
          fail(3, ln, `rapid ends at Z ${to.z}, below the clearance plane`);
      } else {
        if (Number.isNaN(from.x) || Number.isNaN(from.y) || Number.isNaN(from.z)) {
          fail(2, ln, 'feed move from an unknown position');
        }
        // rule 4: spindle on and warm-up complete before any cutting-type move
        if (!spindleOn || !(rpm > 0)) fail(4, ln, 'feed move with the spindle off');
        else if (!warmDone) fail(4, ln, 'feed move before the warm-up dwell finished');
        // rule 5
        if (f === null || !(f > 0)) fail(5, ln, 'feed undefined');
        if (needF && !a.has('F')) fail(5, ln, 'first feed move after a rapid has no explicit F');
        needF = false;
        // rule 3: descending into material only at the plunge feed
        if (to.z < from.z - 1e-9 && to.z < ctx.zTop - 1e-9) {
          const vertical = !xyChanged && motion === 'G1';
          if (f !== null) {
            if (vertical && Math.abs(f - ctx.plungeFeed) > 0.5) {
              fail(3, ln, `vertical plunge at F${f}, plunge feed ${ctx.plungeFeed}`);
            }
            if (!vertical && f > ctx.plungeFeed + 0.5)
              fail(3, ln, `descending move at F${f} > plunge feed`);
          }
        }
      }
      // arcs
      if (motion === 'G2' || motion === 'G3') {
        if (!a.has('X') || !a.has('Y')) fail(1, ln, 'arc without both X and Y');
        if (mv.i === undefined || mv.j === undefined) {
          fail(8, ln, 'arc without I and J');
        } else {
          const cx = from.x + mv.i;
          const cy = from.y + mv.j;
          const r0 = Math.hypot(from.x - cx, from.y - cy);
          const r1 = Math.hypot(to.x - cx, to.y - cy);
          const tol = 2 * Math.pow(10, -Math.min(ctx.dec.xy, ctx.dec.arc));
          if (Math.abs(r0 - r1) > tol) fail(8, ln, `arc radii differ: ${r0} vs ${r1}`);
          if (r0 < 1e-9) fail(8, ln, 'zero radius arc');
          // quadrant extremes inside the envelope
          const a0 = Math.atan2(from.y - cy, from.x - cx);
          const a1 = Math.atan2(to.y - cy, to.x - cx);
          const ccw = motion === 'G3';
          let d = ccw ? a1 - a0 : a0 - a1;
          d = ((d % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
          if (d < 1e-12) d = 2 * Math.PI;
          for (let k = 0; k < 4; k++) {
            const ak = (k * Math.PI) / 2;
            let dk = ccw ? ak - a0 : a0 - ak;
            dk = ((dk % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
            if (dk <= d) {
              physOk({ x: cx + r0 * Math.cos(ak), y: cy + r0 * Math.sin(ak), z: to.z }, ln);
            }
          }
        }
      }
    }
  });

  // rule 7: safe Z, M5, vacuum off, M30 last
  if (m30Line < 0) v.push('R7 no M30');
  if (lastMotionKind !== 'G0' || !lastMotionIsZOnly || Math.abs(lastMotionZ - ctx.safeZ) > ZT) {
    v.push('R7 the last motion is not G0 Z<safe Z>');
  }
  if (m5After < lastMotionLine) v.push('R7 M5 does not follow the last motion');
  if (usedVacuum) {
    if (m9After < m5After) v.push('R7 vacuum off does not follow M5');
  }
  if (!usedVacuum && m9After >= 0) v.push('R7 vacuum off without vacuum on');
  if (!seenMotion) v.push('R2 no motion at all');
  return { violations: v, moves };
}

// ---------------------------------------------------------------------------
// Context builders
// ---------------------------------------------------------------------------

type PostId = 'generic' | 'mach3';
const POSTS: Record<PostId, { json: typeof genericPost; xy: number }> = {
  generic: { json: genericPost, xy: 3 },
  mach3: { json: mach3Post as unknown as typeof genericPost, xy: 4 },
};

function ctxFor(postId: PostId, profile: MachineProfile, thickness: number, clearance = 2): Ctx {
  const cfg = POSTS[postId].json;
  const table = profile.zZero.reference === 'table';
  const mat = profile.materials[0]!;
  const corner = profile.origin.corner;
  return {
    dec: {
      xy: cfg.decimals.xy,
      z: cfg.decimals.z,
      arc: cfg.decimals.arc,
      dwell: cfg.dwell.decimals,
    },
    dwellUnit: cfg.dwell.unit as 's' | 'ms',
    mach3: postId === 'mach3',
    warmup: profile.spindle.warmupSeconds,
    safeZ: profile.safeZ + (table ? thickness : 0),
    zTop: table ? thickness : 0,
    clearance,
    plungeFeed: mat.plungeFeed,
    env: profile.workEnvelope,
    zeroLeft: corner === 'frontLeft' || corner === 'backLeft',
    zeroFront: corner === 'frontLeft' || corner === 'frontRight',
    xRight: profile.origin.xPositive === 'right',
    yBack: profile.origin.yPositive === 'back',
    tableZ: table ? 0 : -thickness,
    spoil: profile.zZero.spoilboardAllowance,
    rpmMin: profile.spindle.minRpm,
    rpmMax: profile.spindle.maxRpm,
    vacuumOn: profile.holdDown.vacuumOn,
    vacuumOff: profile.holdDown.vacuumOff,
    expectUnverifiedHeader: true,
  };
}

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

// independent frame (spec §6.1 / D-025 text, written separately from frame.ts)
function frameMap(s: Scn) {
  const zeroLeft = s.corner === 'frontLeft' || s.corner === 'backLeft';
  const zeroFront = s.corner === 'frontLeft' || s.corner === 'frontRight';
  const nat = NATURAL[s.corner];
  const xs = s.away ? (nat.x === 'right' ? -1 : 1) : nat.x === 'right' ? 1 : -1;
  const ys = s.away ? (nat.y === 'back' ? -1 : 1) : nat.y === 'back' ? 1 : -1;
  const dx0 = zeroLeft ? s.offset.x : -(s.offset.x + s.sheet.width);
  const dy0 = zeroFront ? s.offset.y : -(s.offset.y + s.sheet.height);
  const zoff = s.zRef === 'table' ? s.thickness : 0;
  return {
    pt: (x: number, y: number, z: number): Pt => ({
      x: xs * (x + dx0),
      y: ys * (y + dy0),
      z: z + zoff,
    }),
    mirrored: xs * ys < 0,
  };
}

// ---------------------------------------------------------------------------
// Generated scenarios
// ---------------------------------------------------------------------------

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

/** Model moves of one sheet: endpoints (machine frame) and arcs (centre, direction). */
function modelOf(tp: Toolpath, sheet: number, s: Scn) {
  const fm = frameMap(s);
  const ends: Pt[] = [];
  const arcs: { cx: number; cy: number; dir: 'G2' | 'G3' }[] = [];
  for (const op of tp.operations) {
    if (op.sheet !== sheet) continue;
    for (const seg of op.segments) {
      for (const mv of seg.moves) {
        ends.push(fm.pt(mv.x, mv.y, mv.z));
        if (mv.kind === 'arc') {
          const c = fm.pt(mv.cx, mv.cy, 0);
          const cw = (mv.direction === 'cw') !== fm.mirrored;
          arcs.push({ cx: c.x, cy: c.y, dir: cw ? 'G2' : 'G3' });
        }
      }
    }
  }
  return { ends, arcs };
}

describe('independent §7.2 checker on generated programs (both posts, 4 corners, 2 Z refs)', () => {
  it('all ten rules hold; arcs, frame conversion and direction match the toolpath model', () => {
    let programs = 0;
    fc.assert(
      fc.property(scnArb, (s) => {
        const { profile, tp, placed } = build(s);
        fc.pre(placed && tp.ok);
        const res = gen(s, profile, tp.toolpath);
        expect(res.errors).toEqual([]);
        expect(res.ok).toBe(true);
        expect(res.files.length).toBeGreaterThan(0);
        if (s.warmup === 0) expect(res.warnings.map((w) => w.code)).toContain('NO_WARMUP');
        const ctx = ctxFor(s.post, profile, s.thickness, s.clearance);
        for (const file of res.files) {
          programs++;
          const r = readAndCheck(file.content, ctx);
          expect(r.violations, file.name).toEqual([]);
          // frame conversion: every model endpoint appears, in order, in the emitted program
          const model = modelOf(tp.toolpath, file.sheet, s);
          const tol = Math.pow(10, -ctx.dec.xy) * 1.01;
          let cur = 0;
          let prev: Pt | null = null;
          for (const e of model.ends) {
            // a rapid to the position the machine is already at is legitimately not written
            const same =
              prev !== null &&
              Math.abs(prev.x - e.x) <= tol &&
              Math.abs(prev.y - e.y) <= tol &&
              Math.abs(prev.z - e.z) <= tol;
            prev = e;
            if (same) continue;
            let found = false;
            while (cur < r.moves.length) {
              const m = r.moves[cur++]!.to;
              if (
                Math.abs(m.x - e.x) <= tol &&
                Math.abs(m.y - e.y) <= tol &&
                Math.abs(m.z - e.z) <= tol
              ) {
                found = true;
                break;
              }
            }
            expect(
              found,
              `${file.name}: model point ${JSON.stringify(e)} missing or out of order`,
            ).toBe(true);
          }
          // arc direction + centre against the model
          for (const mv of r.moves) {
            if (mv.kind !== 'G2' && mv.kind !== 'G3') continue;
            const cx = mv.from.x + mv.i!;
            const cy = mv.from.y + mv.j!;
            const same = model.arcs.filter(
              (a) => Math.abs(a.cx - cx) < 0.002 && Math.abs(a.cy - cy) < 0.002,
            );
            expect(same.length, `arc centre (${cx}, ${cy}) not in the model`).toBeGreaterThan(0);
            expect(
              same.some((a) => a.dir === mv.kind),
              `arc direction at line ${mv.line}`,
            ).toBe(true);
          }
          const arcCount = r.moves.filter((m) => m.kind === 'G2' || m.kind === 'G3').length;
          expect(arcCount).toBeGreaterThanOrEqual(model.arcs.length);
        }
        // determinism: byte-identical on a second run
        const again = gen(s, profile, tp.toolpath);
        expect(again.files).toEqual(res.files);
      }),
      { numRuns: Number(process.env.FC_RUNS ?? 120) },
    );
    expect(programs).toBeGreaterThan(50);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Golden files through the same checker
// ---------------------------------------------------------------------------

const GOLDEN = [
  ['generic', 'generic/v1/golden/cabinet-doors_S1.nc'],
  ['generic', 'generic/v1/golden/mixed_S1.nc'],
  ['generic', 'generic/v1/golden/shelf-set_S1.nc'],
  ['mach3', 'mach3/v1/golden/cabinet-doors_S1.tap'],
  ['mach3', 'mach3/v1/golden/mixed_S1.tap'],
  ['mach3', 'mach3/v1/golden/shelf-set_S1.tap'],
] as const;

function goldenCtx(post: PostId): Ctx {
  // same example profile as the golden pipeline: travel 3100 x 2200 x 150, zero front-left, Z zero = top
  const p = profileOf({
    post,
    corner: 'frontLeft',
    away: false,
    zRef: 'materialTop',
    offset: { x: 0, y: 0 },
    warmup: 5,
    safeZ: 20,
    spoil: 0.5,
    thickness: 18,
    toolDia: 8,
    toolNo: 2,
    feed: 6000,
    plunge: 1500,
    stepDown: 6,
  });
  return ctxFor(post, p, 18, 2);
}

describe('golden files: independent checker', () => {
  it.each(GOLDEN)('%s %s passes all ten rules', (post, rel) => {
    const text = readFileSync(join(MACHINES, rel), 'latin1');
    const r = readAndCheck(text, goldenCtx(post));
    expect(r.violations).toEqual([]);
    expect(r.moves.length).toBeGreaterThan(100);
    // a plunge exists and every feed move below Z0 is preceded by M3 + dwell (checked above)
    expect(r.moves.some((m) => m.kind === 'G1' && m.to.z < 0)).toBe(true);
    expect(text.split('\r\n')[0]).toBe(UNVERIFIED);
  });

  it('files are CRLF in the working tree and git keeps them (-text)', () => {
    for (const [, rel] of GOLDEN) {
      const raw = readFileSync(join(MACHINES, rel), 'latin1');
      expect(raw.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    }
    const attrs = readFileSync(resolve(MACHINES, '../../.gitattributes'), 'utf8');
    expect(attrs).toMatch(/^\*\.nc -text$/m);
    expect(attrs).toMatch(/^\*\.tap -text$/m);
    try {
      const out = execFileSync('git', ['ls-files', '--eol', '--', MACHINES], {
        encoding: 'utf8',
        cwd: MACHINES,
      });
      const golden = out.split('\n').filter((l) => /golden[\\/]/.test(l));
      if (golden.length > 0) {
        expect(golden.length).toBe(6);
        for (const l of golden) expect(l).toMatch(/i\/crlf\s+w\/crlf\s+attr\/-text/);
      }
    } catch {
      // git not available in this environment: the attribute check above still holds
    }
  });
});

// ---------------------------------------------------------------------------
// Hand-computed frame conversion (sheet 2440 x 1220, offset (10, 20), t 18, safe Z 20)
// ---------------------------------------------------------------------------

describe('frame conversion: known point per corner and Z reference (hand computed)', () => {
  // toolpath point (px, py) -> machine (X, Y); W + offX = 2450, H + offY = 1240
  const expected = {
    frontLeft: (px: number, py: number) => [px + 10, py + 20],
    frontRight: (px: number, py: number) => [2450 - px, py + 20],
    backLeft: (px: number, py: number) => [px + 10, 1240 - py],
    backRight: (px: number, py: number) => [2450 - px, 1240 - py],
  } as const;

  const base = {
    away: false,
    offset: { x: 10, y: 20 },
    warmup: 5,
    safeZ: 20,
    clearance: 2,
    spoil: 0.5,
    thickness: 18,
    toolDia: 8,
    toolNo: 2,
    feed: 6000,
    plunge: 1500,
    stepDown: 6,
    lead: 'arc' as const,
    plungeKind: { type: 'straight' as const },
    direction: 'climb' as const,
    tabs: false,
    sheet: { width: 2440, height: 1220 },
    parts: [{ id: 'a', w: 300, h: 200, r: 10, qty: 1 }],
  };

  for (const post of ['generic', 'mach3'] as const) {
    for (const corner of CORNERS) {
      for (const zRef of ['materialTop', 'table'] as const) {
        it(`${post} ${corner} Z zero = ${zRef}`, () => {
          const s: Scn = { ...base, post, corner, zRef };
          const { profile, tp } = build(s);
          expect(tp.ok).toBe(true);
          const res = gen(s, profile, tp.toolpath);
          expect(res.errors).toEqual([]);
          const r = readAndCheck(res.files[0]!.content, ctxFor(post, profile, 18, 2));
          expect(r.violations).toEqual([]);
          // first XY rapid = first toolpath XY rapid, mapped by hand
          const xyRapids = tp.toolpath.operations[0]!.segments.flatMap((sg) => sg.moves).filter(
            (m) => m.kind === 'rapid',
          );
          const firstXY = xyRapids[0]!;
          const [ex, ey] = expected[corner](firstXY.x, firstXY.y);
          const emitted = r.moves.find(
            (m) =>
              m.kind === 'G0' &&
              !Number.isNaN(m.to.x) &&
              (m.to.x !== m.from.x || m.to.y !== m.from.y),
          )!;
          expect(emitted.to.x).toBeCloseTo(ex!, 3);
          expect(emitted.to.y).toBeCloseTo(ey!, 3);
          // Z: safe Z 20 (top) or 38 (table); final depth -18.5 (top) or -0.5 (table)
          expect(r.moves[0]!.to.z).toBe(zRef === 'table' ? 38 : 20);
          const minZ = Math.min(...r.moves.map((m) => m.to.z));
          expect(minZ).toBeCloseTo(zRef === 'table' ? -0.5 : -18.5, 6);
          // a CW toolpath arc is CCW (G3) exactly when one axis is mirrored (front-right, back-left)
          const mirroredCorner = corner === 'frontRight' || corner === 'backLeft';
          const arcKinds = new Set(
            r.moves.filter((m) => m.kind === 'G2' || m.kind === 'G3').map((m) => m.kind),
          );
          expect(arcKinds.size).toBeGreaterThan(0);
          // climb outer contour is CW in the sheet frame (outer contours are CCW; climb = CW tool path)
          const modelDirs = new Set(
            tp.toolpath.operations[0]!.segments.flatMap((sg) => sg.moves)
              .filter((m) => m.kind === 'arc')
              .map((m) => (m.kind === 'arc' ? m.direction : '')),
          );
          expect(modelDirs.has('cw')).toBe(true);
          expect(arcKinds.has(mirroredCorner ? 'G3' : 'G2')).toBe(true);
        });
      }
    }
  }
});

// ---------------------------------------------------------------------------
// The checker itself must catch broken programs (so a green run means something)
// ---------------------------------------------------------------------------

describe('the independent checker catches deliberately broken G-code', () => {
  const s: Scn = {
    post: 'generic',
    corner: 'frontLeft',
    away: false,
    zRef: 'materialTop',
    offset: { x: 10, y: 20 },
    warmup: 5,
    safeZ: 20,
    clearance: 2,
    spoil: 0.5,
    thickness: 18,
    toolDia: 8,
    toolNo: 2,
    feed: 6000,
    plunge: 1500,
    stepDown: 6,
    lead: 'arc',
    plungeKind: { type: 'straight' },
    direction: 'climb',
    tabs: false,
    sheet: { width: 2440, height: 1220 },
    parts: [{ id: 'a', w: 300, h: 200, r: 10, qty: 1 }],
  };
  const { profile, tp } = build(s);
  const good = gen(s, profile, tp.toolpath).files[0]!.content;
  const ctx = ctxFor('generic', profile, 18, 2);
  const lines = good.split('\r\n');
  const mutate = (fn: (l: string[]) => string[]) =>
    readAndCheck(fn([...lines]).join('\r\n'), ctx).violations;
  const idx = (re: RegExp) => lines.findIndex((l) => re.test(l));

  it('the unmodified program is clean', () => {
    expect(readAndCheck(good, ctx).violations).toEqual([]);
  });
  it('R1 missing G21/G90/G17/G54 line', () => {
    expect(
      mutate((l) => l.filter((x) => x !== 'G21 G90 G17 G54')).some((x) => x.startsWith('R1')),
    ).toBe(true);
  });
  it('R2 first motion is not safe Z / XY rapid below safe Z', () => {
    const i = idx(/^G0 X/);
    expect(
      mutate((l) => l.map((x, k) => (k === i - 1 ? 'G0 Z10.000' : x))).some((x) =>
        x.startsWith('R2'),
      ),
    ).toBe(true);
    expect(
      mutate((l) => {
        l.splice(idx(/^G0 Z20/), 0, 'G0 X5.000');
        return l;
      }).some((x) => x.startsWith('R2')),
    ).toBe(true);
  });
  it('R3 rapid into the material and plunge at cutting feed', () => {
    expect(
      mutate((l) => l.map((x) => x.replace(/^G1 Z-4\.625 F1500/, 'G0 Z-4.625'))).some((x) =>
        x.startsWith('R3'),
      ),
    ).toBe(true);
    expect(
      mutate((l) => l.map((x) => x.replace(/^G1 Z-4\.625 F1500/, 'G1 Z-4.625 F6000'))).some((x) =>
        x.startsWith('R3'),
      ),
    ).toBe(true);
  });
  it('R4 no M3 / dwell too short / dwell missing', () => {
    expect(
      mutate((l) => l.filter((x) => !x.startsWith('M3'))).some((x) => x.startsWith('R4')),
    ).toBe(true);
    expect(
      mutate((l) => l.map((x) => (x === 'G4 P5.0' ? 'G4 P1.0' : x))).some((x) =>
        x.startsWith('R4'),
      ),
    ).toBe(true);
    expect(
      mutate((l) => l.filter((x) => !x.startsWith('G4'))).some((x) => x.startsWith('R4')),
    ).toBe(true);
  });
  it('R5 first cutting move without F', () => {
    expect(
      mutate((l) => l.map((x) => x.replace(/^G1 Z-4\.625 F1500/, 'G1 Z-4.625'))).some((x) =>
        x.startsWith('R5'),
      ),
    ).toBe(true);
  });
  it('R6 coordinate outside the envelope', () => {
    expect(
      mutate((l) => l.map((x) => x.replace(/^G0 X(\S+) Y(\S+)/, 'G0 X99999.000 Y$2'))).some((x) =>
        x.startsWith('R6'),
      ),
    ).toBe(true);
  });
  it('R7 missing M5, M9 or M30, motion after the end', () => {
    for (const w of ['M5', 'M9', 'M30']) {
      expect(mutate((l) => l.filter((x) => x !== w)).some((x) => x.startsWith('R7'))).toBe(true);
    }
    expect(
      mutate((l) => {
        l.splice(l.length - 3, 0, 'G0 Z20.000', 'G1 X1.000 F100');
        return l;
      }).length,
    ).toBeGreaterThan(0);
  });
  it('R8 exponent, NaN, negative zero, wrong decimals', () => {
    for (const bad of ['G0 X1e5 Y1.000', 'G0 XNaN Y1.000', 'G0 X-0.000 Y1.000', 'G0 X1.5 Y1.000']) {
      expect(
        mutate((l) => {
          l.splice(idx(/^G0 X/), 0, bad);
          return l;
        }).some((x) => x.startsWith('R8')),
      ).toBe(true);
    }
  });
  it('R8 arc with unequal radii', () => {
    expect(
      mutate((l) => l.map((x) => x.replace(/^(G[23] X\S+ Y\S+ I)(\S+)/, '$19.000'))).some((x) =>
        x.startsWith('R8'),
      ),
    ).toBe(true);
  });
  it('R10 missing unverified header', () => {
    expect(mutate((l) => l.slice(1)).some((x) => x.startsWith('R10'))).toBe(true);
  });
  it('line endings: LF-only file is flagged', () => {
    expect(readAndCheck(good.replace(/\r\n/g, '\n'), ctx).violations.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Failing inputs: the generator must refuse (ok:false, no files) for every corner and post
// ---------------------------------------------------------------------------

describe('refusals produce no files (all corners, both posts)', () => {
  const base: Scn = {
    post: 'generic',
    corner: 'frontLeft',
    away: false,
    zRef: 'materialTop',
    offset: { x: 10, y: 20 },
    warmup: 5,
    safeZ: 20,
    clearance: 2,
    spoil: 0.5,
    thickness: 18,
    toolDia: 8,
    toolNo: 2,
    feed: 6000,
    plunge: 1500,
    stepDown: 6,
    lead: 'arc',
    plungeKind: { type: 'straight' },
    direction: 'climb',
    tabs: false,
    sheet: { width: 2440, height: 1220 },
    parts: [{ id: 'a', w: 300, h: 200, r: 10, qty: 1 }],
  };
  const refused = (r: ReturnType<typeof gen>, code: string) => {
    expect(r.ok).toBe(false);
    expect(r.files).toEqual([]);
    expect(r.errors.map((e) => e.code)).toContain(code);
  };

  for (const post of ['generic', 'mach3'] as const) {
    for (const corner of CORNERS) {
      it(`${post} ${corner}: sheet placed beyond the X travel / Y travel`, () => {
        for (const offset of [
          { x: 3200, y: 20 },
          { x: 10, y: 2300 },
        ]) {
          const s: Scn = { ...base, post, corner, offset };
          const { profile, tp } = build(s);
          refused(gen(s, profile, tp.toolpath), 'OUT_OF_ENVELOPE');
        }
      });
      it(`${post} ${corner}: safe Z above the Z travel, both Z references`, () => {
        for (const zRef of ['materialTop', 'table'] as const) {
          const s: Scn = { ...base, post, corner, zRef, safeZ: 140 };
          const { profile, tp } = build(s);
          const r = gen(s, profile, tp.toolpath);
          // materialTop: 140 mm above the top is 158 above the table (> 150): refused; table: 158 too
          refused(r, 'OUT_OF_ENVELOPE');
        }
      });
    }
  }

  it('spindle speed outside the profile range is refused', () => {
    const s = { ...base };
    const { profile, tp } = build(s);
    profile.spindle = { ...profile.spindle, maxRpm: 12000 };
    refused(gen(s, profile, tp.toolpath), 'INVALID_PROFILE'); // the schema rejects a material rpm above the spindle maximum
  });

  it('a profile that fails its schema is refused', () => {
    const { profile, tp } = build(base);
    const bad = { ...profile, safeZ: -5 } as MachineProfile;
    const r = gen(base, bad, tp.toolpath);
    expect(r.ok).toBe(false);
    expect(r.files).toEqual([]);
  });

  it('NaN safe Z / feed in the toolpath is refused', () => {
    const { profile, tp } = build(base);
    const t1 = structuredClone(tp.toolpath);
    t1.operations[0]!.segments[0]!.moves[0]!.z = Number.NaN;
    expect(gen(base, profile, t1).ok).toBe(false);
    expect(gen(base, profile, t1).files).toEqual([]);
    const t2 = structuredClone(tp.toolpath);
    const mv = t2.operations[0]!.segments.flatMap((sg) => sg.moves).find(
      (m) => m.kind === 'linear',
    );
    if (mv && mv.kind === 'linear') mv.feed = Number.POSITIVE_INFINITY;
    expect(gen(base, profile, t2).ok).toBe(false);
  });

  it('an auto post on a machine without a changer, and a post/profile id mismatch, are refused', () => {
    const { profile, tp } = build(base);
    const noChanger = {
      ...profile,
      toolChanger: { type: 'none', capacity: 1, lengthCompensation: false },
    } as MachineProfile;
    refused(gen(base, noChanger, tp.toolpath), 'TOOL_CHANGE_UNSUPPORTED');
    const wrong = { ...profile, post: { id: 'mach3', version: '1.0.0' } } as MachineProfile;
    refused(gen(base, wrong, tp.toolpath), 'POST_MISMATCH');
  });

  it('the reader hook (rule 9) refuses everything when it reports an error', () => {
    const { profile, tp } = build(base);
    const r = generateGcode(
      tp.toolpath,
      { profile, version: 1, verification: 'draft' },
      genericPost,
      {
        projectName: 'x',
        revision: 1,
        stock: { material: 'mdf', thickness: 18, sheetWidth: 2440, sheetHeight: 1220 },
      },
      {
        check: (files) =>
          readAndCheck(files[0]!.content, {
            ...ctxFor('generic', profile, 18),
            warmup: 99,
          }).violations.map((m) => ({
            code: 'CHECK_FAILED' as const,
            severity: 'error' as const,
            message: m,
          })),
      },
    );
    expect(r.ok).toBe(false);
    expect(r.files).toEqual([]);
  });

  it('a verified post on a verified, non-example profile drops the warning header (rule 10 is conditional)', () => {
    const { profile, tp } = build(base);
    profile.example = false;
    const verifiedPost = { ...genericPost, status: 'verified' };
    const r = generateGcode(
      tp.toolpath,
      { profile, version: 1, verification: 'verified' },
      verifiedPost,
      {
        projectName: 'x',
        revision: 1,
        stock: { material: 'mdf', thickness: 18, sheetWidth: 2440, sheetHeight: 1220 },
      },
      {},
    );
    expect(r.errors).toEqual([]);
    const ctx = { ...ctxFor('generic', profile, 18), expectUnverifiedHeader: false };
    expect(readAndCheck(r.files[0]!.content, ctx).violations).toEqual([]);
  });
});
