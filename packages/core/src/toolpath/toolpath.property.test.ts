/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known results */
/**
 * Property tests of the toolpath invariants (spec §6.3, §7.2, T014): random rectangular parts
 * placed by the nesting engine, random cutting options. The checker (toolpath.testing.ts) is
 * written independently of the builder.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { orientation } from '../geometry/polyline';
import { nestProject } from '../nesting';
import type { Project } from '../schema';
import { buildToolpath } from './build';
import {
  clone,
  machineOf,
  passLoop,
  projectOf,
  toolpathViolations,
  type CheckOptions,
} from './toolpath.testing';
import type { PlungeOption, ToolpathOptions } from './types';

const partArb = (i: number) =>
  fc
    .record({
      w: fc.double({ min: 20, max: 600, noNaN: true }),
      h: fc.double({ min: 20, max: 400, noNaN: true }),
      rFrac: fc.oneof(fc.constant(0), fc.double({ min: 0, max: 0.5, noNaN: true })),
      qty: fc.integer({ min: 1, max: 3 }),
    })
    .map(({ w, h, rFrac, qty }) => ({ id: `p${i}`, w, h, r: (rFrac * Math.min(w, h)) / 2, qty }));

const partsArb = fc
  .integer({ min: 1, max: 6 })
  .chain((n) => fc.tuple(...Array.from({ length: n }, (_, i) => partArb(i))));

const plungeArb: fc.Arbitrary<PlungeOption> = fc.oneof(
  fc.constant({ type: 'straight' as const }),
  fc
    .double({ min: 1, max: 30, noNaN: true })
    .map((angleDeg) => ({ type: 'ramp' as const, angleDeg })),
  fc.double({ min: 5, max: 400, noNaN: true }).map((length) => ({ type: 'ramp' as const, length })),
);

const caseArb = fc.record({
  parts: partsArb,
  sheet: fc.record({
    width: fc.double({ min: 600, max: 2440, noNaN: true }),
    height: fc.double({ min: 400, max: 1220, noNaN: true }),
  }),
  gap: fc.double({ min: 0, max: 10, noNaN: true }),
  margin: fc.double({ min: 0, max: 20, noNaN: true }),
  toolDiameter: fc.constantFrom(3, 6, 8, 10, 12),
  thickness: fc.double({ min: 3, max: 30, noNaN: true }),
  spoilboard: fc.double({ min: 0, max: 1, noNaN: true }),
  passDepth: fc.double({ min: 1, max: 35, noNaN: true }),
  lead: fc.constantFrom('arc' as const, 'line' as const, 'none' as const),
  leadLength: fc.option(fc.double({ min: 0.5, max: 15, noNaN: true }), { nil: undefined }),
  plunge: plungeArb,
  direction: fc.constantFrom('climb' as const, 'conventional' as const),
});

type Case = typeof caseArb extends fc.Arbitrary<infer T> ? T : never;

function setUp(c: Case) {
  const unplaced = projectOf({
    parts: c.parts,
    sheet: c.sheet,
    thickness: c.thickness,
    gap: c.gap,
    margin: c.margin,
  });
  const nested = nestProject(unplaced, { toolDiameter: c.toolDiameter });
  const project: Project = { ...unplaced, layout: nested.layout };
  const machine = machineOf({
    toolDiameter: c.toolDiameter,
    spoilboard: c.spoilboard,
    passDepth: c.passDepth,
    thickness: c.thickness,
  });
  const options: ToolpathOptions = {
    lead: c.lead,
    plunge: c.plunge,
    direction: c.direction,
    ...(c.leadLength !== undefined ? { leadLength: c.leadLength } : {}),
  };
  const check: CheckOptions = {
    passDepth: c.passDepth,
    thickness: c.thickness,
    spoilboard: c.spoilboard,
    toolDiameter: c.toolDiameter,
    safeZ: 20,
    plungeFeed: 1500,
    direction: c.direction,
  };
  return { project, machine, options, check, placed: nested.layout.sheets.length > 0 };
}

describe('toolpath invariants (fast-check)', () => {
  it('cutting points at tool radius ± EPS, depths, safe Z, plunge feed, leads, direction', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { project, machine, options, check, placed } = setUp(c);
        fc.pre(placed);
        const res = buildToolpath(project, machine, options);
        // T015: a small part with no room for 2 tabs is an export-blocking error (D-022); the
        // operation is still built and checked. T338 (D-129): likewise a small part whose only tab
        // spots face a neighbour's cut (e.g. a neighbour's arc lead reaching into the web) is
        // refused with SMALL_PART_NOT_HELD (seed 1094944943).
        const refused = new Set(['SMALL_PART_UNSECURED', 'SMALL_PART_NOT_HELD']);
        expect(res.errors.filter((e) => !refused.has(e.code))).toEqual([]);
        expect(res.ok).toBe(res.errors.length === 0);
        expect(res.toolpath.operations.length).toBe(
          project.layout.sheets.reduce((n, s) => n + s.placements.length, 0),
        );
        expect(toolpathViolations(project, res, check)).toEqual([]);
      }),
      { numRuns: 60 },
    );
  });

  it('deterministic: same input, byte-identical result', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { project, machine, options } = setUp(c);
        const a = JSON.stringify(buildToolpath(project, machine, options));
        const b = JSON.stringify(buildToolpath(clone(project), clone(machine), options));
        expect(a).toBe(b);
      }),
      { numRuns: 25 },
    );
  });

  it('climb and conventional travel in opposite directions', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { project, machine, options, placed } = setUp(c);
        fc.pre(placed);
        const climb = buildToolpath(project, machine, { ...options, direction: 'climb' });
        const conv = buildToolpath(project, machine, { ...options, direction: 'conventional' });
        climb.toolpath.operations.forEach((op, i) => {
          const other = conv.toolpath.operations[i]!;
          const last = op.passDepths.length - 1;
          expect(orientation(passLoop(op, last))).toBe('cw');
          expect(orientation(passLoop(other, last))).toBe('ccw');
        });
      }),
      { numRuns: 25 },
    );
  });

  it('summary: cut length at least passes × contour length, time positive and finite', () => {
    fc.assert(
      fc.property(caseArb, (c) => {
        const { project, machine, options, placed } = setUp(c);
        fc.pre(placed);
        const res = buildToolpath(project, machine, options);
        let contour = 0;
        for (const op of res.toolpath.operations) {
          const part = project.parts.find((p) => p.id === op.partId)!;
          if (part.kind !== 'rect') continue;
          const { w, h, r } = part.params;
          const tr = op.toolDiameter / 2;
          // tool-centre loop of a rounded rect: straight edges + a full circle of radius r + tr
          contour +=
            op.passDepths.length * (2 * (w - 2 * r) + 2 * (h - 2 * r) + 2 * Math.PI * (r + tr));
        }
        expect(res.summary.cutLength).toBeGreaterThanOrEqual(contour - 1e-6);
        expect(Number.isFinite(res.summary.estimatedSeconds)).toBe(true);
        expect(res.summary.estimatedSeconds).toBeGreaterThan(0);
      }),
      { numRuns: 25 },
    );
  });
});

describe('the independent checker is sensitive', () => {
  it('flags a cutting move moved off the tool-radius offset by 0.01 mm', () => {
    const project = projectOf({
      parts: [{ id: 'a', w: 100, h: 50 }],
      placements: [[{ partId: 'a', index: 0, x: 100, y: 100, rot: 0 }]],
    });
    const res = clone(buildToolpath(project, machineOf()));
    const pass = res.toolpath.operations[0]!.segments.find((s) => s.role === 'pass')!;
    const line = pass.moves.find((m) => m.kind === 'linear')!;
    line.x += 0.01;
    line.y += 0.01;
    const v = toolpathViolations(project, res, {
      passDepth: 6.1,
      thickness: 18,
      spoilboard: 0.3,
      toolDiameter: 6,
      safeZ: 20,
      plungeFeed: 1500,
      direction: 'climb',
    });
    expect(v.join('\n')).toMatch(/from the part/);
  });
});
