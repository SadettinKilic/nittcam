/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known results */
/**
 * Cut order (spec §6.3, §6.2, §4.5; T016, D-023) on abstract items: random parts of mixed sizes
 * with optional fake holes/pockets/grooves and inner contours on several tools. The checks below
 * are written without the module's helpers.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cutOrder, type CutClass, type CutOrderMode, type OrderItem } from './order';

const RANK: Record<CutClass, number> = { drill: 0, pocket: 0, groove: 0, inner: 1, outer: 2 };
const MODES: CutOrderMode[] = ['minWaste', 'fastest', 'minToolChanges'];

interface Gen {
  sheet: number;
  x: number;
  y: number;
  w: number;
  h: number;
  outerTool: number;
  extras: { cls: CutClass; tool: number; dx: number; dy: number }[];
}

const toolArb = fc.integer({ min: 1, max: 3 });

const partArb: fc.Arbitrary<Gen> = fc.record({
  sheet: fc.integer({ min: 0, max: 2 }),
  x: fc.integer({ min: 0, max: 2400 }),
  y: fc.integer({ min: 0, max: 1200 }),
  // a few fixed sizes so equal areas (tie-breaks) are common
  w: fc.constantFrom(50, 100, 200, 400, 600),
  h: fc.constantFrom(50, 100, 300),
  outerTool: toolArb,
  extras: fc.array(
    fc.record({
      cls: fc.constantFrom<CutClass>('drill', 'pocket', 'groove', 'inner'),
      tool: toolArb,
      dx: fc.integer({ min: 0, max: 50 }),
      dy: fc.integer({ min: 0, max: 50 }),
    }),
    { maxLength: 3 },
  ),
});

/** Items in "placement order": per part its extras, then its outer contour (any order is fine). */
function itemsOf(parts: Gen[], singleTool: boolean): OrderItem[] {
  const items: OrderItem[] = [];
  parts.forEach((p, i) => {
    const part = `p${i}#0`;
    const outer: OrderItem = {
      sheet: p.sheet,
      part,
      cls: 'outer',
      tool: singleTool ? 1 : p.outerTool,
      area: p.w * p.h,
      starts: [
        { x: p.x + p.w / 2, y: p.y },
        { x: p.x + p.w / 2, y: p.y + p.h },
        { x: p.x, y: p.y + p.h / 2 },
      ],
    };
    // put the outer first half of the time, so the input order is no help
    if (i % 2 === 0) items.push(outer);
    for (const e of p.extras) {
      items.push({
        sheet: p.sheet,
        part,
        cls: e.cls,
        tool: singleTool ? 1 : e.tool,
        area: 0,
        starts: [{ x: p.x + e.dx, y: p.y + e.dy }],
      });
    }
    if (i % 2 === 1) items.push(outer);
  });
  return items;
}

const caseArb = fc.record({
  parts: fc.array(partArb, { minLength: 1, maxLength: 14 }),
  singleTool: fc.boolean(),
  mode: fc.constantFrom(...MODES),
});

function d(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe('cut order invariants (fast-check)', () => {
  it('permutation, sheets ascending, within-part order, area order, tool grouping', () => {
    fc.assert(
      fc.property(caseArb, ({ parts, singleTool, mode }) => {
        const items = itemsOf(parts, singleTool);
        const res = cutOrder(items, { mode });
        const seq = res.sequence;
        // permutation: every item exactly once
        expect(seq.map((s) => s.item).sort((a, b) => a - b)).toEqual(items.map((_, i) => i));
        seq.forEach((s) => {
          expect(s.start).toBeGreaterThanOrEqual(0);
          expect(s.start).toBeLessThan(items[s.item]!.starts.length);
        });
        const ordered = seq.map((s) => items[s.item]!);
        // sheets contiguous, ascending
        for (let i = 1; i < ordered.length; i++) {
          expect(ordered[i]!.sheet).toBeGreaterThanOrEqual(ordered[i - 1]!.sheet);
        }
        const pos = new Map(seq.map((s, k) => [s.item, k]));
        items.forEach((a, ia) => {
          items.forEach((b, ib) => {
            if (ia === ib || a.sheet !== b.sheet) return;
            const before = pos.get(ia)! < pos.get(ib)!;
            // holes/pockets/grooves → inner → outer within a part
            if (a.part === b.part && RANK[a.cls] < RANK[b.cls]) expect(before).toBe(true);
            // small parts first (per tool in minToolChanges); equal areas are free
            if (a.cls === 'outer' && b.cls === 'outer' && a.area < b.area) {
              if (mode !== 'minToolChanges' || a.tool === b.tool) expect(before).toBe(true);
            }
          });
        });
        // tool grouping: at every tool change no item of the old tool was ready
        for (let k = 1; k < seq.length; k++) {
          const prev = items[seq[k - 1]!.item]!;
          const cur = items[seq[k]!.item]!;
          if (cur.sheet !== prev.sheet || cur.tool === prev.tool) continue;
          const done = new Set(seq.slice(0, k).map((s) => s.item));
          items.forEach((c, ic) => {
            if (done.has(ic) || c.sheet !== cur.sheet || c.tool !== prev.tool) return;
            const blocked = items.some(
              (b, ib) =>
                !done.has(ib) &&
                ib !== ic &&
                b.sheet === c.sheet &&
                ((b.part === c.part && RANK[b.cls] < RANK[c.cls]) ||
                  (b.cls === 'outer' &&
                    c.cls === 'outer' &&
                    b.area < c.area &&
                    (mode !== 'minToolChanges' || b.tool === c.tool))),
            );
            expect(blocked, `item ${ic} (T${c.tool}) was ready at a tool change`).toBe(true);
          });
        }
      }),
      { numRuns: 300 },
    );
  });

  it('rapid ≤ naive constrained order; the reported lengths match an independent sum', () => {
    fc.assert(
      fc.property(caseArb, ({ parts, singleTool, mode }) => {
        const items = itemsOf(parts, singleTool);
        const res = cutOrder(items, { mode });
        expect(res.rapid).toBeLessThanOrEqual(res.naiveRapid + 1e-6);
        let sum = 0;
        let changes = 0;
        let sheet = -1;
        let at = { x: 0, y: 0 };
        let tool = -1;
        for (const s of res.sequence) {
          const it = items[s.item]!;
          if (it.sheet !== sheet) {
            sheet = it.sheet;
            at = { x: 0, y: 0 };
            tool = it.tool;
          }
          if (it.tool !== tool) changes++;
          tool = it.tool;
          const p = it.starts[s.start]!;
          sum += d(at, p);
          at = p;
        }
        expect(res.rapid).toBeCloseTo(sum, 6);
        expect(res.toolChanges).toBe(changes);
        // the T014 placement order with default starts
        let place = 0;
        for (const sh of new Set(items.map((i) => i.sheet))) {
          let a = { x: 0, y: 0 };
          for (const it of items.filter((i) => i.sheet === sh)) {
            place += d(a, it.starts[0]!);
            a = it.starts[0]!;
          }
        }
        expect(res.placementRapid).toBeCloseTo(place, 6);
      }),
      { numRuns: 300 },
    );
  });

  it('deterministic and 2-opt never makes it longer', () => {
    fc.assert(
      fc.property(caseArb, ({ parts, singleTool, mode }) => {
        const items = itemsOf(parts, singleTool);
        const a = cutOrder(items, { mode });
        const b = cutOrder(JSON.parse(JSON.stringify(items)) as OrderItem[], { mode });
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
        const no2opt = cutOrder(items, { mode, maxEvaluations: 0 });
        expect(a.rapid).toBeLessThanOrEqual(no2opt.rapid + 1e-9);
        expect(no2opt.rapid).toBeLessThanOrEqual(no2opt.naiveRapid + 1e-6);
      }),
      { numRuns: 150 },
    );
  });

  it('single tool: no tool changes', () => {
    fc.assert(
      fc.property(caseArb, ({ parts, mode }) => {
        expect(cutOrder(itemsOf(parts, true), { mode }).toolChanges).toBe(0);
      }),
      { numRuns: 100 },
    );
  });
});

describe('cut order hand cases', () => {
  const outer = (part: string, x: number, w: number, tool = 1): OrderItem => ({
    sheet: 0,
    part,
    cls: 'outer',
    tool,
    area: w * 100,
    starts: [{ x: x + w / 2, y: 0 }],
  });

  it('3 parts in a row (large, medium, small) are cut small, medium, large', () => {
    const items = [outer('large', 0, 600), outer('medium', 700, 300), outer('small', 1100, 100)];
    for (const mode of MODES) {
      const res = cutOrder(items, { mode });
      expect(res.sequence.map((s) => items[s.item]!.part)).toEqual(['small', 'medium', 'large']);
      expect(res.toolChanges).toBe(0);
    }
  });

  it('two tools (holes T1, outer contours T2): one tool change', () => {
    const items: OrderItem[] = [];
    for (const [part, x, w] of [
      ['large', 0, 600],
      ['medium', 700, 300],
      ['small', 1100, 100],
    ] as const) {
      items.push(outer(part, x, w, 2));
      items.push({
        sheet: 0,
        part,
        cls: 'drill',
        tool: 1,
        area: 0,
        starts: [{ x: x + 10, y: 50 }],
      });
    }
    for (const mode of MODES) {
      const res = cutOrder(items, { mode });
      const seq = res.sequence.map((s) => items[s.item]!);
      expect(seq.map((i) => i.tool)).toEqual([1, 1, 1, 2, 2, 2]);
      expect(seq.slice(3).map((i) => i.part)).toEqual(['small', 'medium', 'large']);
      expect(res.toolChanges).toBe(1);
    }
  });

  it('holes, then inner contours, then outer contours (global class order with one tool)', () => {
    const mk = (part: string, cls: CutClass, x: number, area = 0): OrderItem => ({
      sheet: 0,
      part,
      cls,
      tool: 1,
      area,
      starts: [{ x, y: 0 }],
    });
    const items = [
      mk('a', 'outer', 0, 100),
      mk('a', 'inner', 10),
      mk('a', 'drill', 20),
      mk('b', 'outer', 500, 50),
      mk('b', 'pocket', 510),
    ];
    const res = cutOrder(items, { mode: 'minWaste' });
    expect(res.sequence.map((s) => `${items[s.item]!.part}:${items[s.item]!.cls}`)).toEqual([
      'a:drill',
      'b:pocket',
      'a:inner',
      'b:outer',
      'a:outer',
    ]);
  });

  it('minToolChanges keeps each tool in one block when outer contours use two tools', () => {
    // small part on T2, large part on T1: minWaste must cut small first (two changes possible),
    // minToolChanges groups by tool and keeps small-first only within a tool
    const items = [
      outer('big1', 0, 600, 1),
      outer('tiny', 700, 50, 2),
      outer('big2', 1500, 500, 1),
      outer('mid', 2000, 200, 2),
    ];
    const strict = cutOrder(items, { mode: 'minWaste' });
    expect(strict.sequence.map((s) => items[s.item]!.part)).toEqual([
      'tiny',
      'mid',
      'big2',
      'big1',
    ]);
    const grouped = cutOrder(items, { mode: 'minToolChanges' });
    expect(grouped.toolChanges).toBe(1);
  });

  it('equal parts: nearest neighbour from the origin, start points chosen by distance', () => {
    const items: OrderItem[] = [1500, 100, 900].map((x, i) => ({
      sheet: 0,
      part: `p${i}`,
      cls: 'outer',
      tool: 1,
      area: 100,
      starts: [
        { x: x + 50, y: 500 },
        { x: x + 50, y: 0 },
      ],
    }));
    const res = cutOrder(items, { mode: 'minWaste' });
    expect(res.sequence).toEqual([
      { item: 1, start: 1 },
      { item: 2, start: 1 },
      { item: 0, start: 1 },
    ]);
    expect(res.rapid).toBeCloseTo(1550, 9);
    expect(res.placementRapid).toBeGreaterThan(res.rapid);
  });

  it('empty input', () => {
    expect(cutOrder([], { mode: 'fastest' })).toMatchObject({ sequence: [], rapid: 0, sheets: [] });
  });
});
