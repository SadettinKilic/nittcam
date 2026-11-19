/**
 * T272 (D-049 extended to outer contours): a small part whose outline is only arcs (a disc, the
 * sign letter "O") is held by tabs on its arcs instead of being refused. Straight edges stay
 * preferred: arcs are used only when no tab fits on a straight edge. Every tab lies inside one
 * segment (clear of corners and joins) and its raised span is `width + D` long along the contour.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../commands';
import { dxfImportParts, planDxfImport, readDxf } from '../dxf';
import { exportNc } from '../export';
import { EPS } from '../geometry/constants';
import { postConfig } from '../gcode-check/check.testing';
import type { Vertex } from '../geometry/types';
import { nestProject } from '../nesting';
import { goldenProfile, goldenProject } from '../post/golden.testing';
import shelfSet from '../schema/__fixtures__/shelf-set.json';
import { parseProject, type Project } from '../schema';
import { buildToolpath } from './build';
import type { PathSeg } from './path';
import { placeTabs } from './tabs';
import type { ArcMove, Operation } from './types';

const TOOL_D = 8;
const pv = (post: 'generic' | 'mach3') => ({
  profile: goldenProfile(post),
  version: 1,
  verification: 'draft' as const,
});

/** Shelf set (tabs off) + freeform parts with the given outlines, nested. */
function withParts(outlines: Vertex[][]): Project {
  const src = structuredClone(goldenProject(shelfSet, TOOL_D)) as unknown as {
    parts: Record<string, unknown>[];
    cutting: { tabs: Record<string, unknown> };
  };
  src.cutting.tabs = { ...src.cutting.tabs, auto: false };
  const base = src.parts[0] as Record<string, unknown>;
  outlines.forEach((outline, i) => {
    const part: Record<string, unknown> = {
      ...base,
      id: `f${i}`,
      name: `Serbest ${i + 1}`,
      qty: 1,
      holes: [],
      templates: [],
      edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
      kind: 'freeform',
      outline,
      inners: [],
    };
    delete part['params'];
    src.parts.push(part);
  });
  const parsed = parseProject(src);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
  return {
    ...parsed.project,
    layout: nestProject(parsed.project, { toolDiameter: TOOL_D }).layout,
  };
}

const disc = (d: number): Vertex[] => [
  { x: 0, y: d / 2, bulge: 1 },
  { x: d, y: d / 2, bulge: 1 },
];
/** Stadium: two straight sides of length `l` and two half circles of diameter `d` (CCW). */
const stadium = (l: number, d: number): Vertex[] => [
  { x: d / 2, y: 0, bulge: 0 },
  { x: d / 2 + l, y: 0, bulge: 1 },
  { x: d / 2 + l, y: d, bulge: 0 },
  { x: d / 2, y: d, bulge: 1 },
];

function outerOps(p: Project, partId: string): Operation[] {
  const tp = buildToolpath(p, pv('generic').profile);
  return tp.toolpath.operations.filter((o) => o.partId === partId && o.kind === 'outerContour');
}

/** Centre of the final-pass arcs of an all-arc outer contour (all share it). */
function arcCentre(op: Operation): { x: number; y: number } {
  const fin = op.segments.find((s) => s.role === 'pass' && s.final);
  const arc = fin?.moves.find((m): m is ArcMove => m.kind === 'arc');
  if (!arc) throw new Error('no arc');
  return { x: arc.cx, y: arc.cy };
}

describe('tabs on arcs for all-arc outer contours (T272)', () => {
  it('a Ø60 disc gets ≥ 2 tabs on its arcs, at the tool-centre radius, and exports cleanly', () => {
    const p = withParts([disc(60)]);
    const tp = buildToolpath(p, pv('generic').profile);
    expect(tp.errors).toEqual([]);
    expect(tp.warnings.map((w) => w.code)).toContain('SMALL_PART_AUTO_TABS');
    const [op] = outerOps(p, 'f0');
    if (!op) throw new Error('no op');
    expect(op.tabs.length).toBeGreaterThanOrEqual(2);
    const c = arcCentre(op);
    const R = 30 + TOOL_D / 2;
    const width = p.cutting.tabs.width ?? 10;
    for (const t of op.tabs) {
      expect(Math.hypot(t.x0 - c.x, t.y0 - c.y)).toBeCloseTo(R, 6);
      expect(Math.hypot(t.x1 - c.x, t.y1 - c.y)).toBeCloseTo(R, 6);
      expect(Math.abs(t.end - t.start - (width + TOOL_D))).toBeLessThan(EPS);
      expect(t.z).toBeLessThan(0);
      expect(t.z).toBeGreaterThan(tp.toolpath.targetDepth);
    }
    for (const post of ['generic', 'mach3'] as const) {
      const r = exportNc(p, pv(post), postConfig(post));
      expect(r.check?.violations.map((x) => `${x.code}: ${x.message}`) ?? []).toEqual([]);
      expect(r.ok).toBe(true);
    }
  });

  it('straight edges stay preferred: a small stadium keeps its tabs on the straight sides', () => {
    const p = withParts([stadium(120, 40)]);
    const [op] = outerOps(p, 'f0');
    expect(op?.tabs.length).toBeGreaterThanOrEqual(2);
    for (const t of op?.tabs ?? []) {
      // a raised span on an axis-aligned straight side keeps one coordinate
      const flat = Math.abs(t.y1 - t.y0) < EPS || Math.abs(t.x1 - t.x0) < EPS;
      expect(flat).toBe(true);
    }
  });

  it('a sharp corner is never used: a 15 × 15 square (sides too short) stays refused', () => {
    const sq: Vertex[] = [
      { x: 0, y: 0, bulge: 0 },
      { x: 15, y: 0, bulge: 0 },
      { x: 15, y: 15, bulge: 0 },
      { x: 0, y: 15, bulge: 0 },
    ];
    const tp = buildToolpath(withParts([sq]), pv('generic').profile);
    expect(tp.errors.map((e) => e.code)).toEqual(['SMALL_PART_UNSECURED']);
  });

  it('an arc of exactly the tool radius (tool rolling round a sharp corner) never holds a tab', () => {
    // a long loop around a sharp, acute corner: the 300° corner arc (r = 4) would fit a 10 mm span
    const a = (deg: number) => ({
      x: 4 * Math.cos((deg * Math.PI) / 180),
      y: 4 * Math.sin((deg * Math.PI) / 180),
    });
    const segs: PathSeg[] = [
      { p0: a(-150), p1: a(150), bulge: Math.tan((300 * Math.PI) / 180 / 4) },
      { p0: a(150), p1: { x: -200, y: 0 }, bulge: 0 },
      { p0: { x: -200, y: 0 }, p1: a(-150), bulge: 0 },
    ];
    const o = { count: 1, width: 2, toolDiameter: 8, keepFwd: 0, keepBack: 0, minCount: 1, z: -5 };
    const guarded = placeTabs(segs.slice(0, 1), { ...o, onArcs: true, minArcRadius: 4 });
    expect(guarded).toEqual([]);
    expect(placeTabs(segs.slice(0, 1), { ...o, onArcs: true, minArcRadius: 3.9 }).length).toBe(1);
  });
  it('the letters of sign-letters.dxf at 1× size export with tabs and pass the checks', () => {
    const r0 = readDxf(
      readFileSync(join(__dirname, '..', 'dxf', '__fixtures__', 'sign-letters.dxf'), 'utf8'),
    );
    if (!r0.ok) throw new Error(r0.error);
    const parts = dxfImportParts(
      planDxfImport(r0.value),
      (i) => `dxf-${i + 1}`,
      (i) => `Harf ${i + 1}`,
    );
    const base = goldenProject(shelfSet, TOOL_D);
    const imported = applyCommand(base, 'importDxf', { parts, at: { x: 0, y: 0 } });
    if (!imported.ok) throw new Error(imported.error.message);
    const p = {
      ...imported.project,
      layout: nestProject(imported.project, { toolDiameter: TOOL_D }).layout,
    };
    const tp = buildToolpath(p, pv('generic').profile);
    expect(tp.errors).toEqual([]);
    const o = outerOps(p, 'dxf-2')[0];
    expect(o?.tabs.length ?? 0).toBeGreaterThanOrEqual(2);
    for (const post of ['generic', 'mach3'] as const) {
      const r = exportNc(p, pv(post), postConfig(post));
      expect(r.check?.violations.map((x) => `${x.code}: ${x.message}`) ?? []).toEqual([]);
      expect(r.ok).toBe(true);
    }
  });

  it('property: on a circle split into arcs, every tab lies on the contour inside one arc, length w + D ± EPS', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 10, max: 200, noNaN: true }),
        fc.array(fc.double({ min: 0.2, max: 1, noNaN: true }), { minLength: 2, maxLength: 6 }),
        fc.integer({ min: 1, max: 6 }),
        fc.double({ min: 2, max: 20, noNaN: true }),
        fc.constantFrom(3, 6, 8, 12),
        fc.double({ min: 0, max: 30, noNaN: true }),
        (R, weights, count, width, toolD, keep) => {
          // independent description: join angles of the arcs (CCW from angle 0)
          const sum = weights.reduce((a, b) => a + b, 0);
          const joins = [0];
          for (const w of weights)
            joins.push((joins[joins.length - 1] as number) + (w / sum) * 2 * Math.PI);
          const pt = (a: number) => ({ x: R * Math.cos(a), y: R * Math.sin(a) });
          const segs: PathSeg[] = weights.map((_, k) => {
            const a0 = joins[k] as number;
            const a1 = joins[k + 1] as number;
            return { p0: pt(a0), p1: pt(a1), bulge: Math.tan((a1 - a0) / 4) };
          });
          const tabs = placeTabs(segs, {
            count,
            width,
            toolDiameter: toolD,
            keepFwd: keep,
            keepBack: keep,
            minCount: 1,
            z: -5,
            onArcs: true,
          });
          const half = (width + toolD) / 2;
          for (const t of tabs) {
            expect(Math.abs(t.end - t.start - 2 * half)).toBeLessThan(EPS);
            expect(Math.abs(Math.hypot(t.x0, t.y0) - R)).toBeLessThan(EPS);
            expect(Math.abs(Math.hypot(t.x1, t.y1) - R)).toBeLessThan(EPS);
            // the raised span (by angle) stays inside one arc: never on a join
            const a0 = t.start / R;
            const a1 = t.end / R;
            const k = joins.findIndex((j, i) => i > 0 && a0 < j);
            expect(a1).toBeLessThanOrEqual((joins[k] as number) + EPS / R);
            expect(a0).toBeGreaterThanOrEqual((joins[k - 1] as number) - EPS / R);
            // end points match the angles (on the contour where the arc length says)
            expect(Math.abs(t.x0 - R * Math.cos(a0))).toBeLessThan(EPS);
            expect(Math.abs(t.y1 - R * Math.sin(a1))).toBeLessThan(EPS);
            // clear of P (lead keep-outs)
            expect(t.start).toBeGreaterThanOrEqual(keep - EPS);
            expect(t.end).toBeLessThanOrEqual(2 * Math.PI * R - keep + EPS);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
