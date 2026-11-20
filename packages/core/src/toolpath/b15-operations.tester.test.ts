/**
 * B15 tester (T141–T143): read back from the G-code (generic and mach3), not from the toolpath
 * model. One sheet with a part that has an opening, a through hole and an engraved open line,
 * plus small rectangles and a small disc held by a thin skin:
 * - every downward move into the material is a feed move at the plunge feed; rapids stay above it
 * - the engraving never goes below its depth (and never through), the tool centre on the line
 * - inside the opening the tool centre stays ≥ R from the wall; the lead-in reaches deeper into
 *   the waste, and no off-path move follows the path (no lead-out)
 * - per part: holes / on-line → inner → outer
 * - skinned small parts stop at the skin; the cleanup is the last cutting on the sheet, follows
 *   the same loop and goes no deeper than the other through cuts
 * Breaking the on-line depth through the command, the project JSON and a thickness change.
 */
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../commands';
import { postConfig } from '../gcode-check/check.testing';
import { readGcode } from '../gcode-reader';
import type { GcodeMove } from '../gcode-reader';
import { exportNc } from '../export';
import type { Point } from '../geometry/types';
import { goldenProfile } from '../post/golden.testing';
import { parseProject, type Project } from '../schema';
import { buildToolpath } from './build';
import { clone, projectOf } from './toolpath.testing';

const T = 18;
const SKIN = 0.5;
const DEPTH = 3;
const v = (x: number, y: number, bulge = 0) => ({ x, y, bulge });

type Raw = Record<string, unknown>;

function project(
  opts: { skin?: number; lineDepth?: number; ops?: unknown; line?: unknown[] } = {},
): Project {
  const base = clone(
    projectOf({
      parts: [
        { id: 'a', w: 300, h: 200 },
        { id: 's', w: 80, h: 80, qty: 2 },
        { id: 'o', w: 60, h: 60 },
      ],
      placements: [
        [
          { partId: 'a', index: 0, x: 20, y: 20, rot: 0 },
          { partId: 's', index: 0, x: 400, y: 20, rot: 0 },
          { partId: 's', index: 1, x: 500, y: 20, rot: 0 },
          { partId: 'o', index: 0, x: 400, y: 200, rot: 0 },
        ],
      ],
    }),
  ) as unknown as { parts: Raw[]; cutting: Raw };
  const a = base.parts[0] as Raw;
  a['inners'] = [[v(40, 40), v(40, 120), v(140, 120), v(140, 40)]];
  a['holes'] = [{ type: 'through', id: 'h1', d: 20, cx: 220, cy: 150, tool: 1 }];
  a['lines'] = [
    {
      vertices: opts.line ?? [v(180, 40), v(260, 40), v(260, 100)],
      op: { kind: 'online', depth: opts.lineDepth ?? DEPTH },
    },
  ];
  if (opts.ops) a['ops'] = opts.ops;
  const o = base.parts[2] as Raw;
  o['kind'] = 'freeform';
  delete o['params'];
  o['outline'] = [v(0, 30, 1), v(60, 30, 1)];
  if (opts.skin !== undefined) base.cutting['skin'] = { thickness: opts.skin };
  const r = parseProject(base);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.project;
}

const profile = (post: 'generic' | 'mach3') => ({
  profile: goldenProfile(post),
  version: 1,
  verification: 'draft' as const,
});

// ---- independent geometry (sheet frame; part 'a' at (20, 20), rot 0) ----
const OPENING: Point[] = [
  { x: 60, y: 60 },
  { x: 60, y: 140 },
  { x: 160, y: 140 },
  { x: 160, y: 60 },
];
const LINE: Point[] = [
  { x: 200, y: 60 },
  { x: 280, y: 60 },
  { x: 280, y: 120 },
];
const HOLE = { x: 240, y: 170, r: 10 };
const PART_A = { x0: 20, y0: 20, x1: 320, y1: 220 };
const SMALL = [
  { x0: 400, y0: 20, x1: 480, y1: 100 },
  { x0: 500, y0: 20, x1: 580, y1: 100 },
  { x0: 400, y0: 200, x1: 460, y1: 260 },
];

function toSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
const distOpen = (p: Point, pts: Point[]) =>
  Math.min(...pts.slice(0, -1).map((a, i) => toSegment(p, a, pts[i + 1] as Point)));
const distClosed = (p: Point, pts: Point[]) => distOpen(p, [...pts, pts[0] as Point]);
const insideBox = (p: Point, b: { x0: number; y0: number; x1: number; y1: number }, m = 0) =>
  p.x > b.x0 - m && p.x < b.x1 + m && p.y > b.y0 - m && p.y < b.y1 + m;
const insideOpening = (p: Point) => insideBox(p, { x0: 60, y0: 60, x1: 160, y1: 140 });

/** XY samples of a move (arcs sampled along the arc). */
function samples(m: GcodeMove, n = 32): Point[] {
  const out: Point[] = [];
  if (m.arc) {
    const a0 = Math.atan2(m.from.y - m.arc.cy, m.from.x - m.arc.cx);
    const sweep = m.arc.direction === 'ccw' ? Math.abs(m.arc.sweep) : -Math.abs(m.arc.sweep);
    for (let k = 0; k <= n; k++) {
      const a = a0 + (sweep * k) / n;
      out.push({
        x: m.arc.cx + m.arc.radius * Math.cos(a),
        y: m.arc.cy + m.arc.radius * Math.sin(a),
      });
    }
  } else {
    for (let k = 0; k <= n; k++) {
      out.push({
        x: m.from.x + ((m.to.x - m.from.x) * k) / n,
        y: m.from.y + ((m.to.y - m.from.y) * k) / n,
      });
    }
  }
  return out;
}

const cutting = (m: GcodeMove) => m.type !== 'rapid' && Math.min(m.from.z, m.to.z) < 0;
const smallOf = (p: Point) => SMALL.findIndex((b) => insideBox(p, b, 15));

describe.each(['generic', 'mach3'] as const)('B15 tester: %s read-back', (post) => {
  const machine = goldenProfile(post);
  const p = project({ skin: SKIN });
  const tp = buildToolpath(p, machine);
  const res = exportNc(p, profile(post), postConfig(post));
  const read = readGcode(res.files[0]?.content ?? '');
  const moves = read.moves;
  // B51: the first operation may now be another tool (fewest tool changes); use the cut-out tool.
  const outerOp = tp.toolpath.operations.find((o) => o.kind === 'outerContour');
  const R = (outerOp?.toolDiameter ?? 0) / 2;
  const plungeFeed = outerOp?.plungeFeed;
  const zThrough = -(T + machine.zZero.spoilboardAllowance);

  it('exports with no check violations, one file, no reader errors', () => {
    expect(tp.errors).toEqual([]);
    expect(res.check?.violations ?? []).toEqual([]);
    expect(res.ok).toBe(true);
    expect(res.files).toHaveLength(1);
    expect(read.errors).toEqual([]);
    expect(R).toBe(4);
  });

  it('every downward move into the material is a feed move at the plunge feed', () => {
    let checked = 0;
    for (const m of moves) {
      if (!(m.to.z < m.from.z - 1e-9)) continue;
      if (m.type === 'rapid') {
        expect(m.to.z, `line ${m.line}`).toBeGreaterThan(0);
        continue;
      }
      if (m.to.z >= 0) continue;
      expect(m.feed, `line ${m.line}`).toBe(plungeFeed);
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
    // Nothing goes deeper than the through-cut target.
    expect(Math.min(...moves.map((m) => m.to.z))).toBeCloseTo(zThrough, 6);
  });

  it('engraving: tool centre on the line, down to its depth, never deeper near it', () => {
    let onLine = 0;
    let deepest = 0;
    for (const m of moves.filter(cutting)) {
      const pts = samples(m);
      const near = pts.filter((q) => distOpen(q, LINE) < R + 1);
      if (near.length === 0) continue;
      expect(Math.min(m.from.z, m.to.z), `line ${m.line}`).toBeGreaterThanOrEqual(-DEPTH - 1e-6);
      if (pts.every((q) => distOpen(q, LINE) < 1e-3)) {
        onLine++;
        deepest = Math.min(deepest, m.to.z);
      }
    }
    expect(onLine).toBeGreaterThan(0);
    expect(deepest).toBeCloseTo(-DEPTH, 6);
  });

  it('opening: tool centre ≥ R from the wall; lead-in deeper in the waste; no lead-out', () => {
    let run: number[] = []; // per move in the current run: max distance beyond R
    const runs: number[][] = [];
    for (const m of moves) {
      const pts = samples(m);
      if (m.type === 'rapid' || !cutting(m) || !pts.every(insideOpening)) {
        if (run.length) runs.push(run);
        run = [];
        continue;
      }
      const d = pts.map((q) => distClosed(q, OPENING));
      for (const x of d) expect(x, `line ${m.line}`).toBeGreaterThan(R - 0.01);
      run.push(Math.max(...d) - R);
    }
    if (run.length) runs.push(run);
    expect(runs.length).toBeGreaterThan(0);
    // The lead reaches into the opening (the waste) beyond the path.
    expect(runs.some((r) => r.some((x) => x > 0.5))).toBe(true);
    for (const r of runs) {
      // Off-path moves only before the first on-path move (lead-in), never after (no lead-out).
      const firstOn = r.findIndex((x) => x < 0.01);
      expect(firstOn).toBeGreaterThanOrEqual(0);
      expect(r.slice(firstOn).every((x) => x < 0.01)).toBe(true);
    }
  });

  it('part with features: holes / on-line → inner → outer (plunge order)', () => {
    const ranks: number[] = [];
    for (const m of moves) {
      if (m.type === 'rapid' || !(m.to.z < m.from.z) || m.to.z >= 0) continue;
      const q = { x: m.to.x, y: m.to.y };
      if (!insideBox(q, PART_A, 20)) continue;
      if (Math.hypot(q.x - HOLE.x, q.y - HOLE.y) < HOLE.r) ranks.push(0);
      else if (distOpen(q, LINE) < 1e-3) ranks.push(0);
      else if (insideOpening(q)) ranks.push(1);
      else ranks.push(2);
    }
    expect(new Set(ranks)).toEqual(new Set([0, 1, 2]));
    for (let i = 1; i < ranks.length; i++) {
      expect(ranks[i] as number).toBeGreaterThanOrEqual(ranks[i - 1] as number);
    }
  });

  it('thin skin: small parts stop at the skin; cleanups last, same loop, through depth only', () => {
    const skinZ = -(T - SKIN);
    const cuts = moves.map((m, i) => ({ m, i })).filter(({ m }) => cutting(m));
    const lastOther = Math.max(
      ...cuts.filter(({ m }) => samples(m).every((q) => smallOf(q) < 0)).map(({ i }) => i),
    );
    for (const [k] of SMALL.entries()) {
      const mine = cuts.filter(({ m }) => samples(m).every((q) => smallOf(q) === k));
      expect(mine.length).toBeGreaterThan(0);
      const below = mine.filter(({ m }) => Math.min(m.from.z, m.to.z) < skinZ - 1e-6);
      const atSkin = mine.filter(
        ({ m }) => Math.abs(m.from.z - skinZ) < 1e-6 && Math.abs(m.to.z - skinZ) < 1e-6,
      );
      expect(below.length).toBeGreaterThan(0);
      expect(atSkin.length).toBeGreaterThan(0);
      // Below the skin only after every other cut on the sheet.
      for (const { i } of below) expect(i).toBeGreaterThan(lastOther);
      // ... and never deeper than the through cut of every other part.
      expect(Math.min(...below.map(({ m }) => m.to.z))).toBeCloseTo(zThrough, 6);
      // The cleanup follows the skin-level loop (no new XY): every sample within 0.05 mm of it.
      const ref = atSkin.flatMap(({ m }) => samples(m, 256));
      for (const { m } of below) {
        for (const q of samples(m, 8)) {
          const d = Math.min(...ref.map((r) => Math.hypot(r.x - q.x, r.y - q.y)));
          expect(d, `line ${m.line}`).toBeLessThan(0.05);
        }
      }
    }
  });
});

describe('B15 tester: on-line depth cannot reach the thickness', () => {
  const contours = [
    { type: 'outline' },
    { type: 'inner', index: 0 },
    { type: 'line', index: 0 },
  ] as const;

  it.each(contours)('command refuses depth ≥ thickness on %o', (contour) => {
    for (const depth of [T, T + 0.001, 100]) {
      const r = applyCommand(project(), 'setOperation', {
        id: 'a',
        contour,
        kind: 'online',
        depth,
      });
      expect(r.ok).toBe(false);
    }
    for (const depth of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = applyCommand(project(), 'setOperation', {
        id: 'a',
        contour,
        kind: 'online',
        depth,
      });
      expect(r.ok).toBe(false);
    }
  });

  it.each([T, T + 2, T - 1e-9])('project JSON with depth %d on any contour: no file', (depth) => {
    for (const p of [
      project({ ops: { outline: { kind: 'online', depth } } }),
      project({ ops: { inners: [{ kind: 'online', depth }] } }),
      project({ lineDepth: depth }),
    ]) {
      const r = exportNc(p, profile('generic'), postConfig('generic'));
      expect(r.ok).toBe(false);
      expect(r.files).toEqual([]);
      expect(r.toolpathIssues.map((i) => i.code)).toContain('ONLINE_DEPTH_INVALID');
    }
  });

  it('thinner stock after setting the depth: export blocked', () => {
    const r = applyCommand(project({ lineDepth: 10 }), 'setThickness', { thickness: 9 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const e = exportNc(r.project, profile('mach3'), postConfig('mach3'));
    expect(e.ok).toBe(false);
    expect(e.files).toEqual([]);
  });

  it('skin as thick as the stock in the project JSON: no file', () => {
    for (const skin of [T, T + 1]) {
      const r = exportNc(project({ skin }), profile('generic'), postConfig('generic'));
      expect(r.ok).toBe(false);
      expect(r.toolpathIssues.map((i) => i.code)).toContain('INVALID_SKIN');
    }
  });
});
