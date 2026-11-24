/**
 * T338 (CTO #13 M1, D-129): tabs that hold. The predicate on hand-built cutters, the placement
 * through `buildToolpath`, and a property over tight grids checked with plain distances.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Polyline } from '../geometry/types';
import { GOLDEN_OP_FIXTURES, goldenProfile, opFixtureProject } from '../post/golden.testing';
import { buildToolpath } from './build';
import { loopSegments } from './path';
import { cutterIndex, cuttersOf, tabHolds, type Cutter } from './tab-hold';
import { machineOf, projectOf } from './toolpath.testing';
import type { Operation } from './types';

const R = 4; // Ø8

/** CCW tool-centre loop of a 100 × 50 part at (50, 50): corners (46, 46) … (154, 104). */
const loop: Polyline = {
  closed: true,
  vertices: [
    { x: 46, y: 46, bulge: 0 },
    { x: 154, y: 46, bulge: 0 },
    { x: 154, y: 104, bulge: 0 },
    { x: 46, y: 104, bulge: 0 },
  ],
};
const segs = loopSegments(loop);
/** Arc length of the middle of the right edge (x = 154; part edge x = 150). */
const RIGHT = 108 + 29;

/** A vertical cutter line at x (tool centre), the full height. */
const wall = (x: number, op = 'n', pass = true): Cutter => ({
  ax: x,
  ay: 0,
  bx: x,
  by: 200,
  r: R,
  op,
  pass,
});

const holds = (cutters: Cutter[], sheetWidth = 400) =>
  tabHolds(segs, RIGHT, {
    width: 10,
    toolRadius: R,
    ccw: true,
    index: cutterIndex(cutters, { width: sheetWidth, height: 200 }),
    own: 'own',
  });

describe('tabHolds (D-129 predicate)', () => {
  it('a neighbour at the old clearance Ø + 0.1 cuts the anchor away', () => {
    // neighbour edge at 150 + 8.1; its cutter centre one radius to its left
    expect(holds([wall(158.1 - R)])).toBe(false);
  });

  it('a neighbour at 2Ø + 3.1 (pay Ø + 3.1) leaves a 3.1 mm web: holds', () => {
    expect(holds([wall(150 + 19.1 - R)])).toBe(true);
  });

  it('exactly 2Ø + 3 is the limit and does not count (strictly more than 3 mm)', () => {
    expect(holds([wall(150 + 19 - R)])).toBe(false);
  });

  it('a free side holds', () => {
    expect(holds([])).toBe(true);
  });

  it('the sheet edge holds nothing: margin 10 with Ø8 leaves 2 mm (false), Ø + 3 = 11 holds', () => {
    expect(holds([], 160)).toBe(false);
    expect(holds([], 161)).toBe(true);
  });

  it('the own passes do not count, the own lead does', () => {
    expect(holds([wall(156, 'own', true)])).toBe(true);
    expect(holds([wall(156, 'own', false)])).toBe(false);
  });
});

/** Outer contours of a toolpath, with the other ops' cutters at the tab top. */
function outer(ops: readonly Operation[]) {
  return ops.filter((o) => o.kind === 'outerContour');
}

/**
 * Independent of `holdingCentres` (straight tabs of rectangles only): at both ends and the middle
 * of every tab's material, the spoke from the part edge outward through the kerf and 3 mm beyond
 * stays on the sheet and keeps a cutter radius from every other operation's cut at the tab top.
 */
function badTabs(ops: readonly Operation[], sheet: { width: number; height: number }): string[] {
  const out: string[] = [];
  for (const op of outer(ops)) {
    const r = op.toolDiameter / 2;
    const others = cuttersOf(
      ops.filter((o) => o.id !== op.id),
      op.tabs[0]?.z ?? 0,
    );
    const moves = op.segments.filter((s) => s.role === 'pass').flatMap((s) => s.moves);
    const cx = moves.reduce((a, m) => a + m.x, 0) / moves.length;
    const cy = moves.reduce((a, m) => a + m.y, 0) / moves.length;
    for (const t of op.tabs) {
      // x0/y0 … x1/y1 are where the tool rises and lowers: the material is one radius inside
      const len = Math.hypot(t.x1 - t.x0, t.y1 - t.y0);
      const at = (f: number) => [t.x0 + (t.x1 - t.x0) * f, t.y0 + (t.y1 - t.y0) * f] as const;
      for (const [x, y] of [at(r / len), at(0.5), at(1 - r / len)]) {
        // outward normal: perpendicular to the tab, away from the part's middle
        let nx = -(t.y1 - t.y0) / len;
        let ny = (t.x1 - t.x0) / len;
        if (nx * (x - cx) + ny * (y - cy) < 0) [nx, ny] = [-nx, -ny];
        const spoke = Array.from({ length: 41 }, (_, k) => {
          const d = -r + ((2 * r + 3) * k) / 40;
          return [x + nx * d, y + ny * d] as const;
        });
        for (const [sx, sy] of spoke) {
          if (sx < -0.01 || sy < -0.01 || sx > sheet.width + 0.01 || sy > sheet.height + 0.01) {
            out.push(`${op.id}: tab at ${x},${y}: anchor off the sheet`);
            break;
          }
        }
        for (const c of others) {
          const d = Math.min(...spoke.map(([sx, sy]) => distToSeg(sx, sy, c)));
          if (d < c.r - 0.01) out.push(`${op.id}: tab at ${x},${y}: ${c.op} cuts the anchor`);
        }
      }
    }
  }
  return out;
}

function distToSeg(px: number, py: number, c: Cutter): number {
  const dx = c.bx - c.ax;
  const dy = c.by - c.ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - c.ax) * dx + (py - c.ay) * dy) / l2)) : 0;
  return Math.hypot(px - (c.ax + t * dx), py - (c.ay + t * dy));
}

describe('tab placement through buildToolpath (T338)', () => {
  const machine = machineOf({ toolDiameter: 8, thickness: 18 });
  const row = (clear: number, margin: number) =>
    projectOf({
      parts: [{ id: 'p', w: 80, h: 50, qty: 4 }],
      sheet: { width: 2 * margin + 4 * 80 + 3 * clear, height: 2 * margin + 50 },
      margin,
      thickness: 18,
      placements: [
        [0, 1, 2, 3].map((i) => ({
          partId: 'p',
          index: i,
          x: margin + i * (80 + clear),
          y: margin,
          rot: 0,
        })),
      ],
    });

  it('four 80 × 50 side by side at Ø + 0.1, margin 10: no tab holds, every copy refused', () => {
    const p = row(8.1, 10);
    const res = buildToolpath(p, machine);
    expect(res.ok).toBe(false);
    const refused = res.errors.filter((e) => e.code === 'SMALL_PART_NOT_HELD');
    expect(refused).toHaveLength(4);
    expect(refused[0]?.message).toContain('tool diameter + 3');
    // the old, unfiltered output would have put tabs there
    const old = buildToolpath(p, machine, { tabHold: false });
    expect(outer(old.toolpath.operations).every((o) => o.tabs.length >= 2)).toBe(true);
  });

  it('the same row at pay Ø + 3.1 and margin Ø + 3: every tab holds', () => {
    const p = row(19.1, 11);
    const res = buildToolpath(p, machine);
    expect(res.errors).toEqual([]);
    for (const op of outer(res.toolpath.operations)) {
      expect(op.tabs.length).toBeGreaterThanOrEqual(2);
      expect(op.tabsFacing).toBeFalsy();
    }
    expect(badTabs(res.toolpath.operations, p.stock.sheet)).toEqual([]);
  });

  it('wide margin, tight row: tabs only on the free long sides; facing marked', () => {
    const p = row(8.1, 30);
    const res = buildToolpath(p, machine);
    expect(badTabs(res.toolpath.operations, p.stock.sheet)).toEqual([]);
    for (const op of outer(res.toolpath.operations)) {
      const held = op.tabs.length >= 2;
      const refused = res.errors.some(
        (e) => e.code === 'SMALL_PART_NOT_HELD' && e.partId === op.partId && e.copy === op.copy,
      );
      expect(held || refused).toBe(true);
    }
  });
});

describe('tight grids (fast-check, D-129)', () => {
  it('every emitted tab holds; a small part has ≥ 2 tabs or SMALL_PART_NOT_HELD', () => {
    fc.assert(
      fc.property(
        fc.record({
          tool: fc.constantFrom(6, 8),
          cols: fc.integer({ min: 1, max: 4 }),
          rows: fc.integer({ min: 1, max: 3 }),
          w: fc.constantFrom(60, 90, 140),
          h: fc.constantFrom(50, 80),
          pay: fc.constantFrom(0.1, 3, 20),
          margin: fc.constantFrom(5, 10, 14, 30),
        }),
        (c) => {
          const clear = c.tool + c.pay;
          const sheet = {
            width: 2 * c.margin + c.cols * c.w + (c.cols - 1) * clear,
            height: 2 * c.margin + c.rows * c.h + (c.rows - 1) * clear,
          };
          const placements = [];
          for (let i = 0; i < c.cols; i++)
            for (let j = 0; j < c.rows; j++)
              placements.push({
                partId: 'p',
                index: placements.length,
                x: c.margin + i * (c.w + clear),
                y: c.margin + j * (c.h + clear),
                rot: 0,
              });
          const p = projectOf({
            parts: [{ id: 'p', w: c.w, h: c.h, qty: placements.length }],
            sheet,
            margin: c.margin,
            gap: c.pay,
            placements: [placements],
          });
          const res = buildToolpath(p, machineOf({ toolDiameter: c.tool }));
          expect(badTabs(res.toolpath.operations, sheet)).toEqual([]);
          for (const op of outer(res.toolpath.operations)) {
            if (op.tabs.length >= 2) continue;
            expect(
              res.errors.some(
                (e) =>
                  e.code === 'SMALL_PART_NOT_HELD' && e.partId === op.partId && e.copy === op.copy,
              ),
            ).toBe(true);
          }
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe('golden fixture small-rows (D-129)', () => {
  it('two rows of small parts at the default clearance are held with tabs', () => {
    const fx = GOLDEN_OP_FIXTURES.find((f) => f.id === 'small-rows');
    if (!fx) throw new Error('small-rows missing');
    const p = opFixtureProject(fx, 8);
    expect(p.layout.sheets).toHaveLength(1);
    const res = buildToolpath(p, goldenProfile('generic'));
    expect(res.errors).toEqual([]);
    expect(res.warnings.map((w) => w.code)).not.toContain('TABS_NOT_HELD');
    const ops = outer(res.toolpath.operations);
    expect(ops).toHaveLength(8);
    for (const op of ops) expect(op.tabs.length).toBe(op.tabsWanted ?? op.tabs.length);
    expect(badTabs(res.toolpath.operations, p.stock.sheet)).toEqual([]);
  });
});
