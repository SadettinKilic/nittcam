/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known results */
/**
 * Cut order inside the toolpath builder (T016, D-023): random nested rectangles of mixed sizes,
 * every mode. Areas and start points are recomputed here from the part parameters.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { nestProject } from '../nesting';
import type { Project } from '../schema';
import { buildToolpath } from './build';
import { clone, machineOf, projectOf, toolpathViolations } from './toolpath.testing';
import type { Operation, ToolpathResult } from './types';

const MODES = ['minWaste', 'fastest', 'minToolChanges'] as const;

const partArb = (i: number) =>
  fc
    .record({
      w: fc.constantFrom(120, 200, 350, 600, 900),
      h: fc.constantFrom(120, 250, 400),
      rFrac: fc.oneof(fc.constant(0), fc.double({ min: 0, max: 0.5, noNaN: true })),
      qty: fc.integer({ min: 1, max: 4 }),
    })
    .map(({ w, h, rFrac, qty }) => ({ id: `p${i}`, w, h, r: (rFrac * Math.min(w, h)) / 2, qty }));

const caseArb = fc.record({
  parts: fc
    .integer({ min: 1, max: 6 })
    .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => partArb(i)))),
  mode: fc.constantFrom(...MODES),
  sheet: fc.constantFrom({ width: 2440, height: 1220 }, { width: 1500, height: 900 }),
});

type Case = typeof caseArb extends fc.Arbitrary<infer T> ? T : never;

function setUp(c: Case) {
  const base = projectOf({ parts: c.parts, sheet: c.sheet });
  const unplaced: Project = { ...base, nesting: { ...base.nesting, mode: c.mode } };
  const nested = nestProject(unplaced, { toolDiameter: 6 });
  return { project: { ...unplaced, layout: nested.layout }, machine: machineOf() };
}

/** Outline area of a rounded rectangle. */
function areaOf(project: Project, op: Operation): number {
  const part = project.parts.find((p) => p.id === op.partId)!;
  if (part.kind !== 'rect') throw new Error('rect parts only');
  const { w, h, r } = part.params;
  return w * h - (4 - Math.PI) * r * r;
}

/** XY of the lead start of an operation (first move = rapid at safe Z above it). */
function entry(op: Operation) {
  const m = op.segments[0]!.moves[0]!;
  return { x: m.x, y: m.y };
}

function check(project: Project, res: ToolpathResult) {
  const ops = res.toolpath.operations;
  // permutation of the placements
  const placed = project.layout.sheets.flatMap((s, i) =>
    s.placements.map((p) => `${i}:${p.partId}#${p.index}`),
  );
  expect(ops.map((o) => `${o.sheet}:${o.id}`).sort()).toEqual([...placed].sort());
  for (let i = 1; i < ops.length; i++) {
    const a = ops[i - 1]!;
    const b = ops[i]!;
    expect(b.sheet).toBeGreaterThanOrEqual(a.sheet);
    // one tool in M1 → small first on every sheet in every mode; equal areas are tie-broken
    if (a.sheet === b.sheet) {
      expect(areaOf(project, a)).toBeLessThanOrEqual(areaOf(project, b) + 1e-6);
    }
  }
  expect(res.order.toolChanges).toBe(0);
  expect(res.order.rapid).toBeLessThanOrEqual(res.order.naiveRapid + 1e-6);
}

describe('toolpath cut order (fast-check)', () => {
  it('permutation, small first, rapid ≤ naive, T014/T015 checker still clean', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { project, machine } = setUp(c);
        fc.pre(project.layout.sheets.length > 0);
        const res = buildToolpath(project, machine);
        expect(res.order.mode).toBe(c.mode);
        expect(res.errors.filter((e) => e.code !== 'SMALL_PART_UNSECURED')).toEqual([]);
        check(project, res);
        expect(
          toolpathViolations(project, res, {
            passDepth: 6.1,
            thickness: 18,
            spoilboard: 0.3,
            toolDiameter: 6,
            safeZ: 20,
            plungeFeed: 1500,
            direction: 'climb',
          }),
        ).toEqual([]);
      }),
      { numRuns: 40 },
    );
  });

  it('deterministic: byte-identical results', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { project, machine } = setUp(c);
        const a = JSON.stringify(buildToolpath(project, machine));
        const b = JSON.stringify(buildToolpath(clone(project), clone(machine)));
        expect(a).toBe(b);
      }),
      { numRuns: 20 },
    );
  });

  it('each contour starts on a longest straight edge (any edge ≥ half of it in fastest)', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { project, machine } = setUp(c);
        fc.pre(project.layout.sheets.length > 0);
        const res = buildToolpath(project, machine, { lead: 'none' });
        for (const op of res.toolpath.operations) {
          const sheet = project.layout.sheets[op.sheet]!;
          const pl = sheet.placements.find((p) => p.partId === op.partId && p.index === op.copy)!;
          const part = project.parts.find((p) => p.id === op.partId)!;
          if (part.kind !== 'rect') continue;
          const { w, h, r } = part.params;
          const [pw, ph] = pl.rot % 180 === 0 ? [w, h] : [h, w];
          const ex = pw - 2 * r;
          const ey = ph - 2 * r;
          const longest = Math.max(ex, ey);
          const limit = c.mode === 'fastest' ? longest / 2 : longest;
          // midpoints of the four straight edges of the tool-centre loop (tool radius 3)
          const mids = [
            { x: pl.x + pw / 2, y: pl.y - 3, len: ex },
            { x: pl.x + pw / 2, y: pl.y + ph + 3, len: ex },
            { x: pl.x - 3, y: pl.y + ph / 2, len: ey },
            { x: pl.x + pw + 3, y: pl.y + ph / 2, len: ey },
          ].filter((m) => m.len > 1e-3 && m.len >= limit - 1e-3);
          const p = entry(op);
          const hit = mids.some((m) => Math.hypot(m.x - p.x, m.y - p.y) < 1e-6);
          // a rectangle with r = half its short side has no straight edge on that side; skip
          // the degenerate all-arc case (no straight edges at all)
          if (mids.length > 0) expect(hit, `${op.id} starts at ${p.x},${p.y}`).toBe(true);
        }
      }),
      { numRuns: 30 },
    );
  });
});

describe('toolpath cut order hand cases', () => {
  it('3 parts in a row: small, medium, large', () => {
    const project = projectOf({
      parts: [
        { id: 'large', w: 600, h: 400 },
        { id: 'medium', w: 300, h: 300 },
        { id: 'small', w: 150, h: 120 },
      ],
      placements: [
        [
          { partId: 'large', index: 0, x: 20, y: 20, rot: 0 },
          { partId: 'medium', index: 0, x: 700, y: 20, rot: 0 },
          { partId: 'small', index: 0, x: 1100, y: 20, rot: 0 },
        ],
      ],
    });
    for (const mode of MODES) {
      const res = buildToolpath(project, machineOf(), { order: { mode } });
      expect(res.ok).toBe(true);
      expect(res.toolpath.operations.map((o) => o.partId)).toEqual(['small', 'medium', 'large']);
      expect(res.order.toolChanges).toBe(0);
    }
  });

  it('a single part keeps the T014 start (middle of the bottom long edge) in minWaste', () => {
    const project = projectOf({
      parts: [{ id: 'a', w: 600, h: 400 }],
      placements: [[{ partId: 'a', index: 0, x: 100, y: 100, rot: 0 }]],
    });
    const op = buildToolpath(project, machineOf(), { lead: 'none' }).toolpath.operations[0]!;
    expect(entry(op).x).toBeCloseTo(400, 9);
    expect(entry(op).y).toBeCloseTo(97, 9);
  });

  it('fastest may start on a shorter edge closer to the origin', () => {
    const project = projectOf({
      parts: [{ id: 'a', w: 600, h: 400 }],
      placements: [[{ partId: 'a', index: 0, x: 100, y: 100, rot: 0 }]],
    });
    const res = buildToolpath(project, machineOf(), { lead: 'none', order: { mode: 'fastest' } });
    expect(res.ok).toBe(true);
    // left edge midpoint (97, 300) is 314.1 from the origin; bottom (400, 97) is 411.5
    expect(entry(res.toolpath.operations[0]!).x).toBeCloseTo(97, 9);
    expect(entry(res.toolpath.operations[0]!).y).toBeCloseTo(300, 9);
    expect(res.order.rapid).toBeLessThan(res.order.naiveRapid);
  });

  it('the mode defaults to project.nesting.mode; an invalid evaluation budget is refused', () => {
    const base = projectOf({
      parts: [{ id: 'a', w: 600, h: 400 }],
      placements: [[{ partId: 'a', index: 0, x: 100, y: 100, rot: 0 }]],
    });
    const project: Project = { ...base, nesting: { ...base.nesting, mode: 'fastest' } };
    expect(buildToolpath(project, machineOf()).order.mode).toBe('fastest');
    const bad = buildToolpath(project, machineOf(), { order: { maxEvaluations: -1 } });
    expect(bad.ok).toBe(false);
    expect(bad.errors.map((e) => e.code)).toEqual(['INVALID_OPTION']);
  });
});
