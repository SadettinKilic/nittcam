/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known results */
/**
 * T113: placements at any angle (D-034) through toolpath, cut order, tabs, post and the automatic
 * G-code checks. The invariant checker (toolpath.testing.ts) rotates the outline with its own
 * cos/sin, independently of the builder's transform.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { canDownload, checkGcode } from '../gcode-check';
import { golden, postConfig } from '../gcode-check/check.testing';
import { expectedLayouts } from '../gcode-check/layout';
import { exportNc } from '../export/export';
import { bbox, signedArea } from '../geometry/polyline';
import { checkPlacement, placementRect, partSizes } from '../nesting';
import type { Project } from '../schema';
import { buildToolpath, placedOutline } from './build';
import { machineOf, projectOf, toolpathViolations, type CheckOptions } from './toolpath.testing';

const angle = fc.integer({ min: 0, max: 359_999 }).map((n) => n / 1000);

/** Up to 3 parts, each in its own 900 × 900 cell of a big sheet, at random angles. */
const caseArb = fc.record({
  parts: fc.array(
    fc.record({
      w: fc.double({ min: 60, max: 600, noNaN: true }),
      h: fc.double({ min: 60, max: 600, noNaN: true }),
      rFrac: fc.oneof(fc.constant(0), fc.double({ min: 0, max: 0.5, noNaN: true })),
      rot: angle,
    }),
    { minLength: 1, maxLength: 3 },
  ),
  toolDiameter: fc.constantFrom(3, 6, 8, 12),
  lead: fc.constantFrom('arc' as const, 'line' as const, 'none' as const),
  direction: fc.constantFrom('climb' as const, 'conventional' as const),
  tabs: fc.boolean(),
});

type Case = typeof caseArb extends fc.Arbitrary<infer T> ? T : never;

function setUp(c: Case) {
  const project = projectOf({
    parts: c.parts.map((p, i) => ({
      id: `p${i}`,
      w: p.w,
      h: p.h,
      r: (p.rFrac * Math.min(p.w, p.h)) / 2,
    })),
    sheet: { width: 2800, height: 1000 },
    thickness: 18,
    gap: 4,
    margin: 10,
    placements: [
      c.parts.map((p, i) => ({ partId: `p${i}`, index: 0, x: 50 + i * 900, y: 50, rot: p.rot })),
    ],
    direction: c.direction,
  });
  const withTabs: Project = { ...project, cutting: { ...project.cutting, tabs: { auto: c.tabs } } };
  const machine = machineOf({
    toolDiameter: c.toolDiameter,
    thickness: 18,
    passDepth: 6,
    spoilboard: 0.3,
  });
  const check: CheckOptions = {
    passDepth: 6,
    thickness: 18,
    spoilboard: 0.3,
    toolDiameter: c.toolDiameter,
    safeZ: 20,
    plungeFeed: 1500,
    direction: c.direction,
  };
  return { project: withTabs, machine, check };
}

describe('toolpath at any placement angle (T113, fast-check)', () => {
  it('every cutting move stays at tool radius from the rotated part (± EPS); leads stay clear', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { project, machine, check } = setUp(c);
        const res = buildToolpath(project, machine, { lead: c.lead, direction: c.direction });
        expect(res.errors.filter((e) => e.code !== 'SMALL_PART_UNSECURED')).toEqual([]);
        expect(res.toolpath.operations).toHaveLength(c.parts.length);
        expect(toolpathViolations(project, res, check)).toEqual([]);
      }),
      { numRuns: 40 },
    );
  });

  it('the placed outline has the part area at any angle and its bbox starts at (x, y)', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { project } = setUp(c);
        const sizes = partSizes(project);
        for (const pl of project.layout.sheets[0]!.placements) {
          const part = project.parts.find((p) => p.id === pl.partId)!;
          const placed = placedOutline(part, pl);
          const local = placedOutline(part, { x: 0, y: 0, rot: 0 });
          expect(Math.abs(signedArea(placed) - signedArea(local))).toBeLessThan(
            1e-9 * Math.abs(signedArea(local)) + 1e-9,
          );
          const b = bbox(placed);
          expect(Math.abs(b.minX - pl.x)).toBeLessThan(1e-9);
          expect(Math.abs(b.minY - pl.y)).toBeLessThan(1e-9);
          // The footprint the placer and the drag check use is the same bbox (D-034).
          const r = placementRect(pl, sizes)!;
          expect(Math.abs(r.w - (b.maxX - b.minX))).toBeLessThan(1e-9);
          expect(Math.abs(r.h - (b.maxY - b.minY))).toBeLessThan(1e-9);
        }
      }),
      { numRuns: 60 },
    );
  });

  it('deterministic at any angle', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { project, machine } = setUp(c);
        expect(JSON.stringify(buildToolpath(project, machine))).toBe(
          JSON.stringify(buildToolpath(JSON.parse(JSON.stringify(project)) as Project, machine)),
        );
      }),
      { numRuns: 15 },
    );
  });
});

describe('a 30°-rotated part through post, reader and checks (T113 G-code safety)', () => {
  /** The shelf-set golden project with its layout replaced by rotated placements. */
  function rotated(rot: number, post: 'generic' | 'mach3' = 'generic') {
    const g = golden(post, 'shelf-set');
    const part = g.project.parts[0]!;
    const project: Project = {
      ...g.project,
      parts: [{ ...part, qty: 1 }],
      layout: {
        sheets: [
          { placements: [{ partId: part.id, index: 0, x: 200, y: 150, rot, locked: false }] },
        ],
      },
    };
    const pv = { profile: g.context.profile, version: 1, verification: 'draft' as const };
    return { project, pv };
  }

  it.each(['generic', 'mach3'] as const)('%s: exports with zero violations', (post) => {
    const { project, pv } = rotated(30, post);
    const r = exportNc(project, pv, postConfig(post));
    expect(r.toolpathIssues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(r.postErrors).toEqual([]);
    expect(r.check?.violations).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.check && canDownload(r.check)).toBe(true);
    // Fixed decimals only (rule 8) even with irrational coordinates.
    for (const f of r.files) expect(f.content).not.toMatch(/e[+-]?\d|NaN|Infinity/);
  });

  it('the layout check compares positions at any rotation: a moved part is caught', () => {
    const { project, pv } = rotated(30);
    const good = exportNc(project, pv, postConfig('generic'));
    expect(good.ok).toBe(true);
    // Same G-code, but the layout says the part sits 60 mm further right.
    const shifted: Project = {
      ...project,
      layout: {
        sheets: [
          { placements: project.layout.sheets[0]!.placements.map((p) => ({ ...p, x: p.x + 60 })) },
        ],
      },
    };
    const expected = expectedLayouts(shifted).get(0)!;
    const original = expectedLayouts(project).get(0)!;
    expect(expected[0]!.cx - original[0]!.cx).toBeCloseTo(60, 9);
    const g = golden('generic', 'shelf-set');
    const tp = buildToolpath(project, g.context.profile);
    const text = good.files[0]!.content;
    const ctx = { ...g.context, toolpath: tp.toolpath };
    expect(checkGcode(text, { ...ctx, layout: original }).violations).toEqual([]);
    const bad = checkGcode(text, { ...ctx, layout: expected });
    expect(bad.ok).toBe(false);
    expect(bad.violations.map((v) => v.rule)).toContain('LAYOUT');
  });

  it('checkPlacement uses the rotated footprint: a neighbour inside the turned bbox conflicts', () => {
    const { project } = rotated(30);
    const part = project.parts[0]!;
    const two: Project = {
      ...project,
      parts: [{ ...part, qty: 2 }],
    };
    const sizes = partSizes(two);
    const r = placementRect(two.layout.sheets[0]!.placements[0]!, sizes)!;
    // Just right of the unrotated width but inside the rotated bbox → conflict.
    const unrotatedW = sizes.get(part.id)!.w;
    expect(r.w).toBeGreaterThan(unrotatedW);
    const near = {
      partId: part.id,
      index: 1,
      x: 200 + (unrotatedW + r.w) / 2,
      y: 150,
      rot: 30,
      locked: false,
    };
    const res = checkPlacement(two, 0, near, { toolDiameter: 8 });
    expect(res.conflicts).toEqual([{ partId: part.id, index: 0 }]);
  });
});
