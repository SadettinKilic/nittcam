/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known results */
/**
 * Tester review of the cut order (T016, spec 6.3 / 6.2, D-023), independent of the module.
 *
 * Imports NO order helper (no mustPrecede / rapidLength / toolChanges / CUT_CLASS_RANK / order.ts
 * internals): only `buildToolpath` and `cutOrder` outputs are used, and every rule (precedence,
 * readiness, rapid, tool changes, edge midpoints) is re-derived here from the PO decisions:
 * small-before-large by outline area is strict in every mode, naive = the rule-respecting naive
 * order, the rapid metric counts start points only, the next tool is the first needed one.
 * Run count: env NITTCAM_RUNS (default 60).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BENCH_DATASETS } from '../nesting/__bench__/datasets';
import { nest } from '../nesting/nest';
import { nestProject } from '../nesting';
import type { Project } from '../schema';
import { buildToolpath } from './build';
import { cutOrder, type OrderItem } from './order';
import { clone, machineOf, projectOf, toolpathViolations } from './toolpath.testing';
import type { Operation, ToolpathResult } from './types';

const RUNS = Number(
  (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env
    .NITTCAM_RUNS ?? 60,
);
const MODES = ['minWaste', 'fastest', 'minToolChanges'] as const;
type Mode = (typeof MODES)[number];
const TR = 3; // tool radius of machineOf()

// ---------------------------------------------------------------- buildToolpath properties

const partArb = (i: number) =>
  fc
    .record({
      w: fc.constantFrom(100, 150, 200, 350, 600, 900),
      h: fc.constantFrom(100, 120, 250, 400),
      rFrac: fc.oneof(fc.constant(0), fc.double({ min: 0, max: 0.45, noNaN: true })),
      qty: fc.integer({ min: 1, max: 5 }),
    })
    .map(({ w, h, rFrac, qty }) => ({ id: `p${i}`, w, h, r: (rFrac * Math.min(w, h)) / 2, qty }));

const caseArb = fc.record({
  parts: fc
    .integer({ min: 1, max: 7 })
    .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => partArb(i)))),
  mode: fc.constantFrom(...MODES),
  // small sheets force 1-3 sheets
  sheet: fc.constantFrom(
    { width: 2440, height: 1220 },
    { width: 1200, height: 800 },
    { width: 1000, height: 700 },
  ),
});
type Case = typeof caseArb extends fc.Arbitrary<infer T> ? T : never;

function setUp(c: Case) {
  const base = projectOf({ parts: c.parts, sheet: c.sheet });
  const unplaced: Project = { ...base, nesting: { ...base.nesting, mode: c.mode } };
  const nested = nestProject(unplaced, { toolDiameter: 6 });
  return { project: { ...unplaced, layout: nested.layout }, machine: machineOf() };
}

function area(project: Project, op: Operation): number {
  const part = project.parts.find((p) => p.id === op.partId)!;
  if (part.kind !== 'rect') throw new Error('rect only');
  const { w, h, r } = part.params;
  return w * h - (4 - Math.PI) * r * r;
}

/** Midpoints of the straight edges of the tool-centre loop of a placement, with edge lengths. */
function edgeMids(project: Project, op: Operation) {
  const pl = project.layout.sheets[op.sheet]!.placements.find(
    (p) => p.partId === op.partId && p.index === op.copy,
  )!;
  const part = project.parts.find((p) => p.id === op.partId)!;
  if (part.kind !== 'rect') throw new Error('rect only');
  const { w, h, r } = part.params;
  const [pw, ph] = pl.rot % 180 === 0 ? [w, h] : [h, w];
  const ex = pw - 2 * r;
  const ey = ph - 2 * r;
  return [
    { x: pl.x + pw / 2, y: pl.y - TR, len: ex },
    { x: pl.x + pw / 2, y: pl.y + ph + TR, len: ex },
    { x: pl.x - TR, y: pl.y + ph / 2, len: ey },
    { x: pl.x + pw + TR, y: pl.y + ph / 2, len: ey },
  ].filter((m) => m.len > 1e-3);
}

/** Contour start: the end of the lead-in, or the first rapid XY when there is no lead. */
function contourStart(op: Operation) {
  const li = op.segments.find((s) => s.role === 'leadIn');
  if (li) {
    const m = li.moves[li.moves.length - 1]!;
    return { x: m.x, y: m.y };
  }
  const m = op.segments[0]!.moves[0]!;
  return { x: m.x, y: m.y };
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function checkOrder(project: Project, res: ToolpathResult, mode: Mode) {
  const ops = res.toolpath.operations;
  // each placement exactly once
  const placed = project.layout.sheets.flatMap((s, i) =>
    s.placements.map((p) => `${i}:${p.partId}#${p.index}`),
  );
  expect(ops.map((o) => `${o.sheet}:${o.id}`).sort()).toEqual([...placed].sort());
  // sheets increasing, never interleaved; outer contours non-decreasing in area per sheet
  const seen = new Set<number>();
  for (let i = 0; i < ops.length; i++) {
    const b = ops[i]!;
    if (i > 0) {
      const a = ops[i - 1]!;
      expect(b.sheet).toBeGreaterThanOrEqual(a.sheet);
      if (a.sheet === b.sheet)
        expect(area(project, a)).toBeLessThanOrEqual(area(project, b) + 1e-6);
    }
    if (i === 0 || b.sheet !== ops[i - 1]!.sheet) {
      expect(seen.has(b.sheet)).toBe(false);
      seen.add(b.sheet);
    }
  }
  // one tool in M1: no tool change
  expect(res.order.toolChanges).toBe(0);
  expect(new Set(ops.map((o) => o.tool)).size).toBeLessThanOrEqual(1);
  // start of each contour on a straight-edge midpoint (longest edge, or >= half of it in fastest)
  for (const op of ops) {
    const mids = edgeMids(project, op);
    if (mids.length === 0) continue;
    const longest = Math.max(...mids.map((m) => m.len));
    const limit = mode === 'fastest' ? longest / 2 : longest;
    const p = contourStart(op);
    const ok = mids.some((m) => m.len >= limit - 1e-3 && dist(m, p) < 1e-6);
    expect(ok, `${op.id} starts at ${p.x},${p.y}`).toBe(true);
  }
}

describe('tester: cut order through buildToolpath (independent checker)', () => {
  it('permutation, sheets, small first, edge-midpoint starts, T014 checker (default leads)', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { project, machine } = setUp(c);
        fc.pre(project.layout.sheets.length > 0);
        const res = buildToolpath(project, machine);
        expect(res.order.mode).toBe(c.mode);
        expect(res.errors.filter((e) => e.code !== 'SMALL_PART_UNSECURED')).toEqual([]);
        checkOrder(project, res, c.mode);
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
      { numRuns: RUNS },
    );
  }, 600_000);

  it('with tabs on every part: order rules still hold', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { project, machine } = setUp(c);
        fc.pre(project.layout.sheets.length > 0);
        const res = buildToolpath(project, machine, { tabs: { auto: true, count: 4 } });
        expect(res.errors.filter((e) => e.code !== 'SMALL_PART_UNSECURED')).toEqual([]);
        checkOrder(project, res, c.mode);
      }),
      { numRuns: Math.max(10, Math.floor(RUNS / 2)) },
    );
  }, 600_000);

  it('reported rapid = own recomputation from start points (lead none), rapid <= naive', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { project, machine } = setUp(c);
        fc.pre(project.layout.sheets.length > 0);
        const res = buildToolpath(project, machine, { lead: 'none' });
        let sum = 0;
        let pos = { x: 0, y: 0 };
        let sheet = -1;
        for (const op of res.toolpath.operations) {
          if (op.sheet !== sheet) {
            sheet = op.sheet;
            pos = { x: 0, y: 0 };
          }
          const p = contourStart(op);
          sum += dist(pos, p);
          pos = p;
        }
        expect(res.order.rapid).toBeCloseTo(sum, 6);
        expect(res.order.rapid).toBeLessThanOrEqual(res.order.naiveRapid + 1e-6);
        checkOrder(project, res, c.mode);
      }),
      { numRuns: RUNS },
    );
  }, 600_000);

  it('deterministic: byte-identical results, also for cloned input', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { project, machine } = setUp(c);
        const a = JSON.stringify(buildToolpath(project, machine));
        expect(JSON.stringify(buildToolpath(clone(project), clone(machine)))).toBe(a);
        expect(JSON.stringify(buildToolpath(project, machine))).toBe(a);
      }),
      { numRuns: Math.max(10, Math.floor(RUNS / 2)) },
    );
  }, 600_000);
});

// ---------------------------------------------------------------- cutOrder with fake items

type Cls = OrderItem['cls'];
const RANK: Record<Cls, number> = {
  drill: 0,
  pocket: 0,
  groove: 0,
  online: 0,
  inner: 1,
  outer: 2,
};

const itemsArb = fc
  .integer({ min: 1, max: 8 })
  .chain((nParts) =>
    fc.tuple(
      ...Array.from({ length: nParts }, (_, p) =>
        fc.record({
          sheet: fc.integer({ min: 0, max: 2 }),
          area: fc.constantFrom(100, 400, 900, 2500, 10000),
          outerTool: fc.integer({ min: 1, max: 3 }),
          nHoles: fc.integer({ min: 0, max: 3 }),
          nInner: fc.integer({ min: 0, max: 2 }),
          holeTool: fc.integer({ min: 1, max: 3 }),
          innerTool: fc.integer({ min: 1, max: 3 }),
          holeCls: fc.constantFrom<Cls>('drill', 'pocket', 'groove'),
          pts: fc.array(
            fc.record({
              x: fc.integer({ min: 0, max: 2000 }),
              y: fc.integer({ min: 0, max: 1000 }),
            }),
            { minLength: 12, maxLength: 12 },
          ),
          nStarts: fc.integer({ min: 1, max: 3 }),
          p: fc.constant(p),
        }),
      ),
    ),
  )
  .map((parts) => {
    const items: OrderItem[] = [];
    for (const q of parts) {
      let k = 0;
      const mk = (cls: Cls, tool: number): OrderItem => {
        const starts = Array.from({ length: q.nStarts }, () => q.pts[k++ % q.pts.length]!);
        return { sheet: q.sheet, part: `P${q.p}#0`, cls, tool, area: q.area, starts };
      };
      for (let i = 0; i < q.nHoles; i++) items.push(mk(q.holeCls, q.holeTool));
      for (let i = 0; i < q.nInner; i++) items.push(mk('inner', q.innerTool));
      items.push(mk('outer', q.outerTool));
    }
    return items;
  })
  .chain((items) => fc.shuffledSubarray(items, { minLength: items.length }));

/** Precedence from the PO rules, written here. */
function must(a: OrderItem, b: OrderItem, mode: Mode): boolean {
  if (a.sheet !== b.sheet) return a.sheet < b.sheet;
  if (a.part === b.part && RANK[a.cls] < RANK[b.cls]) return true;
  if (a.cls === 'outer' && b.cls === 'outer' && a.area < b.area)
    return mode !== 'minToolChanges' || a.tool === b.tool;
  return false;
}

describe('tester: cutOrder with fake hole/inner items (independent checker)', () => {
  it('permutation, precedence, readiness-only tool changes, own rapid and tool-change sums', () => {
    fc.assert(
      fc.property(itemsArb, fc.constantFrom(...MODES), (items, mode) => {
        const res = cutOrder(items, { mode });
        const seq = res.sequence;
        expect(seq.length).toBe(items.length);
        expect(new Set(seq.map((s) => s.item)).size).toBe(items.length);
        for (const s of seq) {
          expect(s.start).toBeGreaterThanOrEqual(0);
          expect(s.start).toBeLessThan(items[s.item]!.starts.length);
        }
        // no pair violates a rule: nothing that must precede an earlier item comes later
        // (covers sheets ascending/never mixed, within-part class order, outer area order)
        for (let i = 0; i < seq.length; i++)
          for (let j = i + 1; j < seq.length; j++)
            expect(must(items[seq[j]!.item]!, items[seq[i]!.item]!, mode)).toBe(false);
        // tool changes only when no operation of the current tool is ready
        const done = new Set<number>();
        for (let i = 0; i < seq.length; i++) {
          const cur = items[seq[i]!.item]!;
          if (i > 0) {
            const prev = items[seq[i - 1]!.item]!;
            if (prev.sheet === cur.sheet && prev.tool !== cur.tool) {
              items.forEach((it, idx) => {
                if (done.has(idx) || it.sheet !== prev.sheet || it.tool !== prev.tool) return;
                const ready = items.every(
                  (o, oi) => oi === idx || done.has(oi) || !must(o, it, mode),
                );
                expect(ready, `item ${idx} of tool ${it.tool} was ready at change ${i}`).toBe(
                  false,
                );
              });
            }
          }
          done.add(seq[i]!.item);
        }
        // own rapid and tool changes
        let rapid = 0;
        let changes = 0;
        let pos = { x: 0, y: 0 };
        for (let i = 0; i < seq.length; i++) {
          const it = items[seq[i]!.item]!;
          const prev = i > 0 ? items[seq[i - 1]!.item]! : null;
          if (!prev || prev.sheet !== it.sheet) pos = { x: 0, y: 0 };
          else if (prev.tool !== it.tool) changes++;
          const p = it.starts[seq[i]!.start]!;
          rapid += dist(pos, p);
          pos = p;
        }
        expect(res.rapid).toBeCloseTo(rapid, 6);
        expect(res.toolChanges).toBe(changes);
        expect(res.rapid).toBeLessThanOrEqual(res.naiveRapid + 1e-6);
        // deterministic
        expect(JSON.stringify(cutOrder(items, { mode }))).toBe(JSON.stringify(res));
      }),
      { numRuns: RUNS * 2 },
    );
  }, 600_000);
});

// ---------------------------------------------------------------- hand cases

describe('tester: hand cases', () => {
  it('small / medium / large in a row, any placement order -> S, M, L', () => {
    const parts = [
      { id: 'large', w: 600, h: 400 },
      { id: 'medium', w: 300, h: 300 },
      { id: 'small', w: 150, h: 120 },
    ];
    const at = { large: 20, medium: 700, small: 1100 } as const;
    const perms = [
      ['large', 'medium', 'small'],
      ['small', 'medium', 'large'],
      ['medium', 'large', 'small'],
      ['medium', 'small', 'large'],
    ] as const;
    for (const perm of perms)
      for (const mode of MODES) {
        const project = projectOf({
          parts,
          placements: [
            perm.map((id) => ({ partId: id, index: 0, x: at[id], y: 20, rot: 0 as const })),
          ],
        });
        const res = buildToolpath(project, machineOf(), { order: { mode } });
        expect(res.toolpath.operations.map((o) => o.partId)).toEqual(['small', 'medium', 'large']);
      }
  });

  it('two equal-area parts: the nearer one is cut first (either placement order)', () => {
    for (const first of ['far', 'near'] as const) {
      const near = { partId: 'a', index: 0, x: 20, y: 20, rot: 0 as const };
      const far = { partId: 'a', index: 1, x: 1800, y: 600, rot: 0 as const };
      const project = projectOf({
        parts: [{ id: 'a', w: 300, h: 200, qty: 2 }],
        placements: [first === 'far' ? [far, near] : [near, far]],
      });
      for (const mode of MODES) {
        const res = buildToolpath(project, machineOf(), { order: { mode } });
        expect(res.toolpath.operations.map((o) => o.copy)).toEqual([0, 1]);
      }
    }
  });

  it('holes on T1, outers on T2, 3 parts: exactly 1 tool change, holes before outers', () => {
    const items: OrderItem[] = [
      { x: 1500, a: 900 },
      { x: 100, a: 400 },
      { x: 800, a: 2500 },
    ].flatMap((p, i) => [
      {
        sheet: 0,
        part: `P${i}#0`,
        cls: 'drill' as const,
        tool: 1,
        area: p.a,
        starts: [{ x: p.x + 10, y: 50 }],
      },
      {
        sheet: 0,
        part: `P${i}#0`,
        cls: 'outer' as const,
        tool: 2,
        area: p.a,
        starts: [{ x: p.x, y: 0 }],
      },
    ]);
    for (const mode of MODES) {
      const res = cutOrder(items, { mode });
      expect(res.toolChanges).toBe(1);
      const cls = res.sequence.map((s) => items[s.item]!.cls);
      expect(cls).toEqual(['drill', 'drill', 'drill', 'outer', 'outer', 'outer']);
      const areas = res.sequence.slice(3).map((s) => items[s.item]!.area);
      expect(areas).toEqual([400, 900, 2500]);
    }
  });

  it('fastest rapid <= minWaste rapid on the kitchen set; both <= naive', () => {
    const entry = BENCH_DATASETS.find((d) => d.name === 'kitchen cabinets')!;
    const nested = nest(entry.input);
    const base = projectOf({
      parts: entry.input.parts.map((p) => ({ id: p.id, w: p.w, h: p.h, qty: p.qty })),
      sheet: entry.input.sheet,
      gap: entry.input.gap,
      margin: entry.input.margin,
    });
    const machine = machineOf({ toolDiameter: entry.input.toolDiameter });
    const run = (mode: Mode) => {
      const project: Project = {
        ...base,
        parts: base.parts.map((p, i) => ({
          ...p,
          grainLock: entry.input.parts[i]?.grainLock ?? false,
        })),
        nesting: { ...base.nesting, mode },
        layout: nested.layout,
      };
      const res = buildToolpath(project, machine);
      expect(res.ok).toBe(true);
      expect(res.order.rapid).toBeLessThanOrEqual(res.order.naiveRapid + 1e-6);
      return res.order;
    };
    const fast = run('fastest');
    const waste = run('minWaste');
    expect(fast.rapid).toBeLessThanOrEqual(waste.rapid + 1e-6);
    expect(fast.naiveRapid).toBeGreaterThan(0);
  });

  it('invalid budgets are INVALID_OPTION', () => {
    const project = projectOf({
      parts: [{ id: 'a', w: 600, h: 400 }],
      placements: [[{ partId: 'a', index: 0, x: 100, y: 100, rot: 0 }]],
    });
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, -0.001]) {
      const res = buildToolpath(project, machineOf(), { order: { maxEvaluations: bad } });
      expect(res.ok, String(bad)).toBe(false);
      expect(res.errors.map((e) => e.code)).toEqual(['INVALID_OPTION']);
      expect(res.toolpath.operations).toEqual([]);
    }
    for (const good of [0, 1, 100]) {
      expect(buildToolpath(project, machineOf(), { order: { maxEvaluations: good } }).ok).toBe(
        true,
      );
    }
  });
});
