/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known results */
/**
 * T114: the placer takes its rotations from `allowedRotations` (D-034). Axis-aligned angles place
 * the rectangle as before; other angles place the bbox of the rotated outline and report
 * GRAIN_ROTATED_BBOX. Overlap is checked on the exact rotated rectangles, not on the bboxes.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { allowedRotations } from '../geometry/grain';
import type { Point } from '../geometry/types';
import type { Project } from '../schema';
import { placedOutline } from '../toolpath/build';
import { projectOf } from '../toolpath/toolpath.testing';
import { validateProject } from '../validate';
import { nest, nestingInputFromProject, nestProject } from './nest';
import { invariantViolations } from './nest.testing';

const EPS = 1e-6;

/** A project with the given parts, grains and sheet grain. */
function grained(
  parts: { w: number; h: number; qty?: number; mode: 'free' | 'fixed'; angle: number }[],
  sheetGrain: number | null,
  sheet = { width: 2800, height: 2070 },
): Project {
  const p = projectOf({
    parts: parts.map((x, i) => ({ id: `p${i}`, w: x.w, h: x.h, qty: x.qty ?? 1 })),
    sheet,
    gap: 8,
    margin: 10,
  });
  return {
    ...p,
    stock: { ...p.stock, sheet: { ...p.stock.sheet, grain: sheetGrain } },
    parts: p.parts.map((part, i) => ({
      ...part,
      grain: { mode: parts[i]!.mode, angle: parts[i]!.angle },
    })),
  };
}

const mod = (a: number, m: number) => ((a % m) + m) % m;

// --- exact polygon geometry (independent of the placer) -------------------------------------

function corners(project: Project, sheet: number): { key: string; pts: Point[] }[] {
  return project.layout.sheets[sheet]!.placements.map((pl) => {
    const part = project.parts.find((p) => p.id === pl.partId)!;
    return { key: `${pl.partId}#${pl.index}`, pts: placedOutline(part, pl).vertices };
  });
}

function segDist(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function inside(p: Point, poly: Point[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/** Distance between two convex polygons; 0 when they overlap. */
function polyDist(a: Point[], b: Point[]): number {
  if (a.some((p) => inside(p, b)) || b.some((p) => inside(p, a))) return 0;
  let best = Infinity;
  for (const [x, y] of [
    [a, b],
    [b, a],
  ] as const) {
    for (const p of x) {
      for (let i = 0; i < y.length; i++)
        best = Math.min(best, segDist(y[i]!, y[(i + 1) % y.length]!, p));
    }
  }
  return best;
}

// --- tests ----------------------------------------------------------------------------------

describe('grain-aware placer (T114)', () => {
  it('a fixed 30° part is placed only at 30°/210° and reports GRAIN_ROTATED_BBOX', () => {
    const project = grained([{ w: 600, h: 300, qty: 3, mode: 'fixed', angle: 0 }], 30);
    const res = nestProject(project, { toolDiameter: 8, engine: 'maxrects' });
    const pls = res.layout.sheets.flatMap((s) => s.placements);
    expect(pls).toHaveLength(3);
    for (const pl of pls) expect([30, 210]).toContain(pl.rot);
    expect(res.info).toHaveLength(3);
    const rad = (30 * Math.PI) / 180;
    const bw = 600 * Math.cos(rad) + 300 * Math.sin(rad);
    const bh = 600 * Math.sin(rad) + 300 * Math.cos(rad);
    for (const i of res.info) {
      expect(i.code).toBe('GRAIN_ROTATED_BBOX');
      expect(i.extraArea).toBeCloseTo(bw * bh - 600 * 300, 6);
    }
  });

  it('axis-aligned rules are unchanged: fixed on a 90° sheet turns 90°/270°; free keeps 0/90', () => {
    const turned = nestProject(grained([{ w: 600, h: 300, mode: 'fixed', angle: 0 }], 90), {
      toolDiameter: 8,
    });
    expect(turned.layout.sheets[0]!.placements[0]!.rot).toBe(90);
    expect(turned.info).toEqual([]);
    const fixed0 = nestProject(
      grained([{ w: 600, h: 300, qty: 4, mode: 'fixed', angle: 90 }], 90),
      {
        toolDiameter: 8,
      },
    );
    for (const pl of fixed0.layout.sheets[0]!.placements) expect(pl.rot).toBe(0);
  });

  it('a migrated v1 project nests exactly as before (grainLock → rotations)', () => {
    const project = grained(
      [
        { w: 700, h: 400, qty: 3, mode: 'fixed', angle: 0 },
        { w: 500, h: 900, qty: 2, mode: 'free', angle: 0 },
      ],
      0,
    );
    const input = nestingInputFromProject(project, { toolDiameter: 8 });
    const legacy = {
      ...input,
      parts: input.parts.map((p, i) => ({
        id: p.id,
        w: p.w,
        h: p.h,
        qty: p.qty,
        grainLock: i === 0,
      })),
    };
    const now = nest(input);
    expect(now.info).toEqual([]);
    expect(JSON.stringify(now)).toBe(JSON.stringify(nest(legacy)));
  });

  it('PART_LARGER_THAN_SHEET respects the forced rotation', () => {
    const sheet = { width: 2800, height: 1000 };
    const issues = (p: Project) =>
      validateProject(p).filter((i) => i.code === 'PART_LARGER_THAN_SHEET');
    // Free: fits lying down.
    expect(issues(grained([{ w: 2000, h: 500, mode: 'free', angle: 0 }], 0, sheet))).toEqual([]);
    // Fixed with the grain across: must stand up (500 × 2000) → too tall.
    const across = issues(grained([{ w: 2000, h: 500, mode: 'fixed', angle: 90 }], 0, sheet));
    expect(across).toHaveLength(1);
    expect(across[0]!.message).toMatch(/only at 90° \/ 270°/);
    // Fixed at 30°: the rotated bbox is about 1982 × 1433 → too tall too.
    expect(issues(grained([{ w: 2000, h: 500, mode: 'fixed', angle: 0 }], 30, sheet))).toHaveLength(
      1,
    );
    // And the placer agrees: TOO_LARGE.
    const res = nestProject(grained([{ w: 2000, h: 500, mode: 'fixed', angle: 0 }], 30, sheet), {
      toolDiameter: 8,
    });
    expect(res.unplaced).toEqual([{ partId: 'p0', index: 0, reason: 'TOO_LARGE' }]);
  });
});

const partArb = fc.record({
  w: fc.integer({ min: 50, max: 900 }),
  h: fc.integer({ min: 50, max: 700 }),
  qty: fc.integer({ min: 1, max: 4 }),
  mode: fc.constantFrom('free' as const, 'fixed' as const),
  angle: fc.integer({ min: 0, max: 179_999 }).map((n) => n / 1000),
});

const caseArb = fc.record({
  parts: fc.array(partArb, { minLength: 1, maxLength: 6 }),
  sheetGrain: fc.oneof(
    fc.constant(null),
    fc.constantFrom(0, 90),
    fc.integer({ min: 0, max: 179_999 }).map((n) => n / 1000),
  ),
  toolDiameter: fc.constantFrom(6, 8, 12),
});

describe('grain-aware placer properties (fast-check)', () => {
  it('no overlap (exact rotated rectangles), inside the margin, gap kept, grain rule holds', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const unplaced = grained(c.parts, c.sheetGrain);
        const res = nestProject(unplaced, { toolDiameter: c.toolDiameter, engine: 'maxrects' });
        const project: Project = { ...unplaced, layout: res.layout };
        const input = nestingInputFromProject(unplaced, {
          toolDiameter: c.toolDiameter,
          engine: 'maxrects',
        });
        expect(invariantViolations(input, res)).toEqual([]);
        const spacing = c.toolDiameter + unplaced.nesting.gap;
        const { width, height } = unplaced.stock.sheet;
        const m = unplaced.nesting.margin;
        project.layout.sheets.forEach((_, si) => {
          const polys = corners(project, si);
          for (const { pts } of polys) {
            for (const q of pts) {
              expect(q.x).toBeGreaterThanOrEqual(m - EPS);
              expect(q.y).toBeGreaterThanOrEqual(m - EPS);
              expect(q.x).toBeLessThanOrEqual(width - m + EPS);
              expect(q.y).toBeLessThanOrEqual(height - m + EPS);
            }
          }
          for (let i = 0; i < polys.length; i++) {
            for (let j = i + 1; j < polys.length; j++) {
              expect(polyDist(polys[i]!.pts, polys[j]!.pts)).toBeGreaterThanOrEqual(spacing - EPS);
            }
          }
          for (const pl of project.layout.sheets[si]!.placements) {
            const part = project.parts.find((p) => p.id === pl.partId)!;
            expect(allowedRotations(part, project.stock.sheet)).toContain(pl.rot);
            if (part.grain.mode === 'fixed' && project.stock.sheet.grain !== null) {
              const d = mod(part.grain.angle + pl.rot - project.stock.sheet.grain, 180);
              expect(Math.min(d, 180 - d)).toBeLessThan(1e-6);
            }
          }
        });
        // Every non-axis placement has its info note.
        const rotated = project.layout.sheets
          .flatMap((s) => s.placements)
          .filter((p) => p.rot % 90 !== 0);
        expect(res.info).toHaveLength(rotated.length);
        for (const i of res.info) expect(i.extraArea).toBeGreaterThanOrEqual(-EPS);
      }),
      { numRuns: 60 },
    );
  });

  it('deterministic: same input, byte-identical result', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const p = grained(c.parts, c.sheetGrain);
        const a = JSON.stringify(nestProject(p, { toolDiameter: c.toolDiameter }));
        const b = JSON.stringify(
          nestProject(JSON.parse(JSON.stringify(p)) as Project, { toolDiameter: c.toolDiameter }),
        );
        expect(a).toBe(b);
      }),
      { numRuns: 20 },
    );
  });
});
