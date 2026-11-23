/// <reference types="node" />
/**
 * Tester review of the B14 hole goldens (T139–T140, D-050, D-051): the four new files are read
 * back here by a small G-code interpreter written for this test only (no generator, reader or
 * toolpath import), and every §7.2 rule plus the hole geometry is checked against values worked
 * out by hand from the fixture (panel 400 × 300, copy 0 at (100, 100) 0°, copy 1 at (700, 100)
 * turned 90° CCW → local (x, y) lands at (1000 − y, 100 + x)).
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MACHINES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../machines');
const SAFE_Z = 20;
const CLEAR_Z = 2;
const PLUNGE_F = 1500;
const TOOL_D: Record<number, number> = { 1: 6, 2: 8 };
const TOL = 0.002;

interface Mv {
  line: number;
  g: 0 | 1 | 2 | 3;
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
  f: number;
  tool: number;
  centre?: { x: number; y: number };
}

interface Run {
  moves: Mv[];
  problems: string[];
  toolChanges: number[];
}

/** Minimal independent interpreter: absolute XYZ, incremental I/J, modal G0–G3 and F. */
function interpret(text: string): Run {
  const lines = text.split('\r\n');
  const problems: string[] = [];
  const moves: Mv[] = [];
  const toolChanges: number[] = [];
  const pos = { x: Number.NaN, y: Number.NaN, z: Number.NaN };
  let g: 0 | 1 | 2 | 3 | undefined;
  let f = Number.NaN;
  let spindle = false;
  let dwellAfterSpindle = false;
  let tool = 0;
  let sawHeader = false;
  let firstMotion = true;
  let firstCut = true;
  lines.forEach((raw, i) => {
    const n = i + 1;
    const code = raw.replace(/\([^)]*\)/g, '').trim();
    const manual = /^\(TAKIM(?: DEGISTIR:)? T(\d+) /.exec(raw);
    if (manual) {
      // mach3: manual change comment, then M0 (operator swaps the tool with the spindle off)
      if (spindle) problems.push(`L${n}: tool change with the spindle on`);
      if (!(pos.z >= SAFE_Z - TOL)) problems.push(`L${n}: tool change below safe Z`);
      if (lines[i + 1]?.trim() !== 'M0') problems.push(`L${n}: manual tool change without M0`);
      tool = Number(manual[1]);
      toolChanges.push(tool);
      dwellAfterSpindle = false;
    }
    if (!code) return;
    if (/\d[eE][+-]?\d|NaN|Infinity|[A-Z](?![-\d])/.test(code.replace(/\s+/g, ''))) {
      problems.push(`L${n}: exponent/NaN in "${raw}"`);
    }
    const words = [...code.matchAll(/([A-Z])(-?\d+(?:\.\d+)?)/g)].map((m) => ({
      l: m[1] as string,
      v: Number(m[2]),
      s: m[2] as string,
    }));
    const gs = words.filter((w) => w.l === 'G').map((w) => w.v);
    const ms = words.filter((w) => w.l === 'M').map((w) => w.v);
    if (gs.includes(21) && gs.includes(90) && gs.includes(17) && gs.includes(54)) sawHeader = true;
    const tWord = words.find((w) => w.l === 'T');
    if (tWord && ms.includes(6)) {
      if (spindle) problems.push(`L${n}: tool change with the spindle on`);
      if (!(pos.z >= SAFE_Z - TOL)) problems.push(`L${n}: tool change below safe Z`);
      tool = tWord.v;
      toolChanges.push(tool);
      dwellAfterSpindle = false;
    }
    if (ms.includes(3)) {
      spindle = true;
      dwellAfterSpindle = false;
    }
    if (gs.includes(4) && spindle) dwellAfterSpindle = true;
    if (ms.includes(5)) spindle = false;
    const fw = words.find((w) => w.l === 'F');
    if (fw) f = fw.v;
    for (const gg of gs) if (gg >= 0 && gg <= 3 && Number.isInteger(gg)) g = gg as 0 | 1 | 2 | 3;
    const ax = (l: string) => words.find((w) => w.l === l)?.v;
    const x = ax('X');
    const y = ax('Y');
    const z = ax('Z');
    if (x === undefined && y === undefined && z === undefined) return;
    if (!sawHeader) problems.push(`L${n}: motion before G21 G90 G17 G54`);
    if (g === undefined) {
      problems.push(`L${n}: motion without a motion mode`);
      return;
    }
    const from = { ...pos };
    const to = { x: x ?? pos.x, y: y ?? pos.y, z: z ?? pos.z };
    if (firstMotion) {
      firstMotion = false;
      if (!(g === 0 && x === undefined && y === undefined && to.z >= SAFE_Z - TOL)) {
        problems.push(`L${n}: first move is not straight up to safe Z`);
      }
    }
    const lateral = Math.hypot(to.x - from.x, to.y - from.y) > TOL;
    if (g === 0) {
      if (lateral && (from.z < SAFE_Z - TOL || to.z < SAFE_Z - TOL)) {
        problems.push(`L${n}: XY rapid below safe Z (${from.z} → ${to.z})`);
      }
      if (to.z < from.z - TOL && to.z < CLEAR_Z - TOL) {
        problems.push(`L${n}: rapid down to Z${to.z} (below clearance)`);
      }
    } else {
      if (!spindle || !dwellAfterSpindle) problems.push(`L${n}: feed move before spindle + dwell`);
      if (firstCut) {
        firstCut = false;
        if (!fw) problems.push(`L${n}: first cutting move does not state F`);
      }
      if (!(f > 0)) problems.push(`L${n}: feed undefined`);
      if (to.z < from.z - 1e-9 && Math.abs(f - PLUNGE_F) > 1e-9) {
        problems.push(`L${n}: downward move at F${f}, plunge feed is ${PLUNGE_F}`);
      }
    }
    const mv: Mv = { line: n, g, from, to, f, tool };
    if (g === 2 || g === 3) {
      const iw = ax('I');
      const jw = ax('J');
      if (iw === undefined || jw === undefined) problems.push(`L${n}: arc without I/J`);
      const c = { x: from.x + (iw ?? 0), y: from.y + (jw ?? 0) };
      const r0 = Math.hypot(from.x - c.x, from.y - c.y);
      const r1 = Math.hypot(to.x - c.x, to.y - c.y);
      if (Math.abs(r0 - r1) > TOL) problems.push(`L${n}: arc radius ${r0} ≠ ${r1}`);
      mv.centre = c;
    }
    moves.push(mv);
    pos.x = to.x;
    pos.y = to.y;
    pos.z = to.z;
  });
  // Program end: safe Z, spindle off, end code.
  const tail = lines.filter((l) => l.trim() !== '').slice(-4);
  if (!tail.some((l) => /^M30\b/.test(l))) problems.push('no M30 at the end');
  if (spindle) problems.push('spindle still on at the end');
  if (!(pos.z >= SAFE_Z - TOL)) problems.push(`program ends at Z${pos.z}`);
  return { moves, problems, toolChanges };
}

/** Cutting blocks: the moves between two XY rapids, with the tool and the extent of the cut. */
interface Block {
  first: number;
  tool: number;
  cuts: Mv[];
}

function blocks(run: Run): Block[] {
  const out: Block[] = [];
  let cur: Block | undefined;
  for (const m of run.moves) {
    const lateralRapid = m.g === 0 && Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y) > TOL;
    if (lateralRapid || Number.isNaN(m.from.x)) {
      cur = { first: m.line, tool: m.tool, cuts: [] };
      out.push(cur);
      continue;
    }
    if (cur && m.to.z < 0 - TOL) cur.cuts.push(m);
    else if (cur && m.g !== 0 && m.from.z < 0 - TOL) cur.cuts.push(m);
  }
  return out.filter((b) => b.cuts.length > 0);
}

interface ExpectedHole {
  id: string;
  local: { x: number; y: number };
  tool: number;
  /** Wall radius (pocket/through) or the ring's inner/outer edge (groove). */
  inner: number;
  outer: number;
  depth: number;
}

const place = (copy: 0 | 1, p: { x: number; y: number }) =>
  copy === 0 ? { x: p.x + 100, y: p.y + 100 } : { x: 1000 - p.y, y: 100 + p.x };

const THROUGH: ExpectedHole[] = [
  { id: 'h1', local: { x: 60, y: 60 }, tool: 2, inner: 0, outer: 4, depth: 18.5 },
  { id: 'h2', local: { x: 200, y: 150 }, tool: 2, inner: 0, outer: 17.5, depth: 18.5 },
  { id: 'h3', local: { x: 340, y: 240 }, tool: 1, inner: 0, outer: 10, depth: 18.5 },
];
const BLIND: ExpectedHole[] = [
  { id: 'h1', local: { x: 100, y: 150 }, tool: 2, inner: 0, outer: 17.5, depth: 12.5 },
  { id: 'h2', local: { x: 60, y: 60 }, tool: 2, inner: 0, outer: 4, depth: 10 },
  { id: 'h3', local: { x: 230, y: 150 }, tool: 2, inner: 26, outer: 34, depth: 3 },
  { id: 'h4', local: { x: 330, y: 200 }, tool: 2, inner: 33, outer: 47, depth: 4 },
];

/** Extent of a block around a centre: [min, max] distance of the tool edge from it, deepest Z. */
function extent(b: Block, c: { x: number; y: number }) {
  const r = (TOOL_D[b.tool] ?? Number.NaN) / 2;
  let rMin = Number.POSITIVE_INFINITY;
  let rMax = 0;
  let zMin = 0;
  let centred = true;
  for (const m of b.cuts) {
    for (const p of [m.from, m.to]) {
      if (p.z > -TOL) continue;
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      rMin = Math.min(rMin, d);
      rMax = Math.max(rMax, d);
    }
    if (m.centre && m.from.z < -TOL) {
      // a full or half circle around the hole centre: its radius is reached all round
      if (Math.hypot(m.centre.x - c.x, m.centre.y - c.y) > TOL) centred = false;
    }
    zMin = Math.min(zMin, m.to.z);
  }
  return { inner: Math.max(0, rMin - r), outer: rMax + r, zMin, rMinCentre: rMin, centred };
}

const CASES = [
  ['generic', 'holes-through_S1.nc', THROUGH],
  ['mach3', 'holes-through_S1.tap', THROUGH],
  ['generic', 'holes-blind_S1.nc', BLIND],
  ['mach3', 'holes-blind_S1.tap', BLIND],
] as const;

describe('B14 hole goldens read back independently (tester, D-051)', () => {
  it.each(CASES)('%s %s', (post, file, holes) => {
    const text = readFileSync(join(MACHINES, post, 'v1', 'golden', file), 'latin1');
    expect(text.split('\r\n')[0]).toBe('(DOGRULANMADI, once air cut)');
    const run = interpret(text);
    expect(run.problems).toEqual([]);

    const bs = blocks(run);
    const used = new Set<number>();
    const through = file.includes('through');
    // Every expected hole of both copies is cut once, with its tool, to its depth, wall exact.
    for (const copy of [0, 1] as const) {
      for (const h of holes) {
        const c = place(copy, h.local);
        const idx = bs.findIndex((b, k) => {
          if (used.has(k)) return false;
          const e = extent(b, c);
          return e.centred && e.outer <= h.outer + 1 && e.rMinCentre < h.outer;
        });
        expect(idx, `${file} copy ${copy} ${h.id} at ${c.x},${c.y}`).toBeGreaterThanOrEqual(0);
        used.add(idx);
        const b = bs[idx] as Block;
        expect(b.tool, `${h.id} tool`).toBe(h.tool);
        const e = extent(b, c);
        expect(Math.abs(e.zMin + h.depth), `${h.id} depth ${e.zMin}`).toBeLessThan(TOL);
        expect(Math.abs(e.outer - h.outer), `${h.id} wall ${e.outer}`).toBeLessThan(TOL);
        if (h.inner > 0) expect(Math.abs(e.inner - h.inner), `${h.id} inner`).toBeLessThan(TOL);
        else if (h.outer > (TOOL_D[h.tool] ?? Number.NaN) / 2 + TOL) {
          // a cleared hole: the centre is under the tool (no slug, no island)
          expect(e.rMinCentre).toBeLessThan((TOOL_D[h.tool] ?? Number.NaN) / 2);
        }
      }
    }
    // The rest are the two outer contours, each cut after that copy's holes.
    const rest = bs.map((b, k) => ({ b, k })).filter(({ k }) => !used.has(k));
    expect(rest.length).toBe(2);
    for (const { b, k } of rest) {
      const xs = b.cuts.map((m) => m.to.x);
      const copyOf = Math.min(...xs) < 600 ? 0 : 1;
      const holeBlocks = [...used].filter((u) => {
        const xs2 = (bs[u] as Block).cuts.map((m) => m.to.x);
        return (Math.min(...xs2) < 600 ? 0 : 1) === copyOf;
      });
      expect(holeBlocks.length).toBe(holes.length);
      expect(Math.max(...holeBlocks)).toBeLessThan(k);
      expect(Math.min(...b.cuts.map((m) => m.to.z))).toBeCloseTo(-18.5, 6);
    }
    // Nothing anywhere below the deepest allowed Z.
    const zMin = Math.min(...run.moves.map((m) => m.to.z));
    expect(zMin).toBeCloseTo(-18.5, 6);
    if (!through) {
      // Blind holes never go below their own depth (checked per block above); only contours reach 18.5.
      expect(rest.every(({ b }) => b.cuts.some((m) => m.to.z < -18.4))).toBe(true);
    }
    // Tool changes: through = T1, T2 (B51 fewest changes); blind = T2 only.
    expect(run.toolChanges).toEqual(through ? [1, 2] : [2]);
  });
});

describe('the tester interpreter is not blind (mutations of holes-through generic)', () => {
  const text = readFileSync(
    join(MACHINES, 'generic', 'v1', 'golden', 'holes-through_S1.nc'),
    'latin1',
  );
  const mutate = (from: string, to: string) => {
    expect(text.includes(from)).toBe(true);
    return interpret(text.replace(from, to));
  };
  it.each([
    ['peck at the lateral feed', 'G1 Z-4.625 F1500', 'G1 Z-4.625 F6000'],
    [
      'helix turn at the lateral feed',
      'Z-0.578 I-3.200 J0.000 F1500',
      'Z-0.578 I-3.200 J0.000 F6000',
    ],
    ['rapid plunge into the material', 'G1 Z-4.625 F1500', 'G0 Z-4.625'],
    ['XY rapid at clearance height', 'G0 Z20.000\r\nG0 X303.200', 'G0 Z2.000\r\nG0 X303.200'],
    ['spindle never started', 'M3 S18000\r\nG4 P5.0\r\nG0 X442', 'G0 X442'],
    ['no M30', 'M30', ''],
    ['exponent number', 'G1 Z-9.250', 'G1 Z-9.25e0'],
  ])('%s', (_what, from, to) => {
    expect(mutate(from, to).problems.length).toBeGreaterThan(0);
  });
});
