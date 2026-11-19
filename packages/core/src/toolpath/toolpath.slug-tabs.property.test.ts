/**
 * D-049 (owner 2026-11-19): a cut-out's slug follows the small-part rule (D-022). A small slug
 * (area < 50 000 mm² or a bounding-box side < 100 mm) gets at least 2 tabs even with tabs off,
 * also on arcs (round openings), never on an arc too short for a tab; no room → the export is
 * refused (`SMALL_SLUG_UNSECURED`). A large slug follows the project's tab setting. Inner stays
 * before outer, and the program passes every rule-9 check.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { exportNc } from '../export';
import { postConfig } from '../gcode-check/check.testing';
import type { Vertex } from '../geometry/types';
import { nestProject } from '../nesting';
import { goldenProfile, goldenProject } from '../post/golden.testing';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { parseProject, type Project } from '../schema';
import { buildToolpath } from './build';

const TOOL_D = 8;
const v = (x: number, y: number, bulge = 0): Vertex => ({ x, y, bulge });
const circle = (cx: number, cy: number, r: number): Vertex[] => [
  v(cx - r, cy, -1),
  v(cx + r, cy, -1),
];
const rect = (x0: number, y0: number, x1: number, y1: number): Vertex[] => [
  v(x0, y0),
  v(x0, y1),
  v(x1, y1),
  v(x1, y0),
];
const pv = { profile: goldenProfile('generic'), version: 1, verification: 'draft' as const };

/** Shelf set + one 600 × 600 part (large, no auto tabs) with the given cut-outs. */
function withOpenings(inners: Vertex[][], tabsOn = false): Project {
  const src = structuredClone(goldenProject(shelfSet, TOOL_D)) as unknown as {
    parts: Record<string, unknown>[];
    cutting: { tabs: Record<string, unknown> };
  };
  src.cutting.tabs = { ...src.cutting.tabs, auto: tabsOn };
  src.parts.push({
    ...(src.parts[0] as Record<string, unknown>),
    id: 'plate',
    name: 'Plaka',
    qty: 1,
    holes: [],
    templates: [],
    edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
    params: { w: 600, h: 600, r: 0 },
    inners,
  });
  const parsed = parseProject(src);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return {
    ...parsed.project,
    layout: nestProject(parsed.project, { toolDiameter: TOOL_D }).layout,
  };
}

describe('cut-out slugs follow the small-part rule (D-049)', () => {
  it('property: a small round or rectangular slug is held by ≥ 2 tabs (or refused); the export passes the checks', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: 12, max: 120 }).map((r) => ({ kind: 'circle' as const, a: r, b: r })),
          fc
            .tuple(fc.integer({ min: 15, max: 400 }), fc.integer({ min: 15, max: 99 }))
            .map(([a, b]) => ({ kind: 'rect' as const, a, b })),
        ),
        (o) => {
          const inner =
            o.kind === 'circle' ? circle(300, 300, o.a) : rect(100, 100, 100 + o.a, 100 + o.b);
          const p = withOpenings([inner]);
          const tp = buildToolpath(p, pv.profile);
          const r = exportNc(p, pv, postConfig('generic'));
          if (!tp.ok) {
            // never cut free: refused with the slug code only
            expect(tp.errors.map((e) => e.code)).toEqual(['SMALL_SLUG_UNSECURED']);
            expect(r.ok).toBe(false);
            expect(r.stage).toBe('toolpath');
            return;
          }
          const ops = tp.toolpath.operations.filter((x) => x.partId === 'plate');
          expect(ops.map((x) => x.kind)).toEqual(['innerContour', 'outerContour']);
          const inOp = ops[0];
          expect(inOp?.tabs.length ?? 0).toBeGreaterThanOrEqual(2);
          for (const t of inOp?.tabs ?? []) {
            expect(t.z).toBeGreaterThan(tp.toolpath.targetDepth);
            expect(t.z).toBeLessThan(0);
          }
          expect(tp.warnings.map((w) => w.code)).toContain('SMALL_SLUG_AUTO_TABS');
          expect(r.check?.violations.map((x) => `${x.code}: ${x.message}`) ?? []).toEqual([]);
          expect(r.ok).toBe(true);
        },
      ),
      { numRuns: 40 },
    );
  });

  it('a round opening gets its tabs on the arcs', () => {
    const tp = buildToolpath(withOpenings([circle(300, 300, 60)]), pv.profile);
    expect(tp.errors).toEqual([]);
    const op = tp.toolpath.operations.find((x) => x.kind === 'innerContour');
    expect(op?.tabs.length).toBeGreaterThanOrEqual(2);
  });

  it('too small for 2 tabs: SMALL_SLUG_UNSECURED blocks the export', () => {
    // Ø20 opening, 8 mm tool: the tool-centre loop is ~19 mm long, two 18 mm raised spans never fit.
    const p = withOpenings([circle(300, 300, 10)]);
    const tp = buildToolpath(p, pv.profile);
    expect(tp.ok).toBe(false);
    expect(tp.errors.map((e) => e.code)).toEqual(['SMALL_SLUG_UNSECURED']);
    const r = exportNc(p, pv, postConfig('generic'));
    expect(r.ok).toBe(false);
    expect(r.files).toEqual([]);
  });

  it('a large slug follows the project setting: no tabs with tabs off, tabs with tabs on', () => {
    const big = [rect(100, 100, 400, 400)];
    const off = buildToolpath(withOpenings(big, false), pv.profile);
    expect(off.errors).toEqual([]);
    expect(off.toolpath.operations.find((x) => x.kind === 'innerContour')?.tabs).toEqual([]);
    const on = buildToolpath(withOpenings(big, true), pv.profile);
    expect(on.errors).toEqual([]);
    const op = on.toolpath.operations.find((x) => x.kind === 'innerContour');
    expect(op?.tabs.length ?? 0).toBeGreaterThan(0);
    expect(on.warnings.map((w) => w.code)).not.toContain('SMALL_SLUG_AUTO_TABS');
  });
});
