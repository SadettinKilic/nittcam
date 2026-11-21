/**
 * T325 (D-112): rectangular / closed-shape blind pocket on an inner contour. Command, rings,
 * toolpath moves (ramp entry, step-over, floor, wall), validation, export through the independent
 * G-code check, and property tests over random rectangles, depths and tools.
 */
import fc from 'fast-check';
import { applyPatches, enablePatches } from 'immer';
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../commands';
import { postConfig } from '../gcode-check/check.testing';
import { exportNc } from '../export';
import { contour } from '../geometry/polyline';
import { goldenProfile } from '../post/golden.testing';
import { parseProject, type Project } from '../schema';
import { validateProject } from '../validate';
import { buildToolpath } from './build';
import { CONTOUR_POCKET_DEFAULTS, contourPocketRings } from './contour-pocket';
import { clone, projectOf } from './toolpath.testing';
import type { Move, Operation } from './types';

enablePatches();

const profile = (post: 'generic' | 'mach3') => ({
  profile: goldenProfile(post),
  version: 1,
  verification: 'draft' as const,
});

type V = { x: number; y: number; bulge: number };

const rectInner = (x0: number, y0: number, w: number, h: number): V[] => [
  { x: x0, y: y0, bulge: 0 },
  { x: x0, y: y0 + h, bulge: 0 },
  { x: x0 + w, y: y0 + h, bulge: 0 },
  { x: x0 + w, y: y0, bulge: 0 },
];

/** Part 300 × 200, one copy at (20, 20) rotated `rot`, with the given inner contours. */
function base(inners: V[][], rot = 0): Project {
  const p = clone(
    projectOf({
      parts: [{ id: 'a', w: 300, h: 200 }],
      placements: [[{ partId: 'a', index: 0, x: 20, y: 20, rot }]],
    }),
  ) as unknown as { parts: Record<string, unknown>[] };
  (p.parts[0] as Record<string, unknown>)['inners'] = inners;
  const r = parseProject(p);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.project;
}

function run(p: Project, name: string, params: unknown): Project {
  const r = applyCommand(p, name, params);
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.project;
}

const pocketed = (inners: V[][], depth: number, rot = 0): Project =>
  run(base(inners, rot), 'setOperation', {
    id: 'a',
    contour: { type: 'inner', index: 0 },
    kind: 'pocket',
    depth,
  });

const moves = (op: Operation): Move[] => op.segments.flatMap((s) => s.moves);

/** Sampled XY points of a move list (arcs: their end points; rings are short arcs or lines). */
function trace(op: Operation): { x: number; y: number; z: number }[] {
  return moves(op).map((m) => ({ x: m.x, y: m.y, z: m.z }));
}

describe('setOperation pocket (T325)', () => {
  it('sets a pocket with a depth on an inner contour; one undo step', () => {
    const p0 = base([rectInner(40, 40, 100, 80)]);
    const r = applyCommand(p0, 'setOperation', {
      id: 'a',
      contour: { type: 'inner', index: 0 },
      kind: 'pocket',
      depth: 8,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.project.parts[0]?.ops?.inners?.[0]).toEqual({ kind: 'pocket', depth: 8 });
    expect(applyPatches(r.project, r.inversePatches)).toEqual(p0);
  });

  it('refuses a pocket without depth, as deep as the stock, on the outline or on a line', () => {
    const p0 = base([rectInner(40, 40, 100, 80)]);
    const bad = (params: Record<string, unknown>) =>
      applyCommand(p0, 'setOperation', { id: 'a', kind: 'pocket', ...params }).ok;
    expect(bad({ contour: { type: 'inner', index: 0 } })).toBe(false);
    expect(bad({ contour: { type: 'inner', index: 0 }, depth: p0.stock.thickness })).toBe(false);
    expect(bad({ contour: { type: 'inner', index: 0 }, depth: 0 })).toBe(false);
    expect(bad({ contour: { type: 'outline' }, depth: 5 })).toBe(false);
  });

  it('property: apply then undo restores the project byte for byte', () => {
    const p0 = base([rectInner(40, 40, 100, 80)]);
    fc.assert(
      fc.property(fc.double({ min: 0.5, max: p0.stock.thickness - 0.01, noNaN: true }), (d) => {
        const r = applyCommand(p0, 'setOperation', {
          id: 'a',
          contour: { type: 'inner', index: 0 },
          kind: 'pocket',
          depth: d,
        });
        if (!r.ok) return;
        expect(JSON.stringify(applyPatches(r.project, r.inversePatches))).toBe(JSON.stringify(p0));
      }),
      { numRuns: 30 },
    );
  });
});

describe('contourPocketRings (T325)', () => {
  it('rings step in by at most 40 % of the tool, innermost first, the wall last', () => {
    const res = contourPocketRings(contour(rectInner(0, 0, 100, 60)), 6);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const wall = res.rings[res.rings.length - 1];
    const xs = wall?.vertices.map((v) => v.x) ?? [];
    expect(Math.min(...xs)).toBeCloseTo(3, 6);
    expect(Math.max(...xs)).toBeCloseTo(97, 6);
    // inradius 30: rings at 3, 5.4, … < 30
    expect(res.rings.length).toBe(Math.floor((30 - 3) / (0.4 * 6) - 1e-9) + 1);
  });

  it('a pocket narrower than the tool, or one with a neck, is refused', () => {
    expect(contourPocketRings(contour(rectInner(0, 0, 5, 60)), 6)).toMatchObject({
      ok: false,
      code: 'POCKET_TOO_SMALL',
    });
    // Dumbbell: two 40 × 40 squares joined by a 10 mm neck, tool 6: the 3rd ring splits.
    const dumbbell: V[] = [
      { x: 0, y: 0, bulge: 0 },
      { x: 0, y: 40, bulge: 0 },
      { x: 40, y: 40, bulge: 0 },
      { x: 40, y: 25, bulge: 0 },
      { x: 60, y: 25, bulge: 0 },
      { x: 60, y: 40, bulge: 0 },
      { x: 100, y: 40, bulge: 0 },
      { x: 100, y: 0, bulge: 0 },
      { x: 60, y: 0, bulge: 0 },
      { x: 60, y: 15, bulge: 0 },
      { x: 40, y: 15, bulge: 0 },
      { x: 40, y: 0, bulge: 0 },
    ];
    expect(contourPocketRings(contour(dumbbell), 6)).toMatchObject({
      ok: false,
      code: 'POCKET_SPLIT',
    });
  });
});

describe('contour pocket toolpath (T325)', () => {
  const thickness = base([]).stock.thickness;

  it('clears the rectangle: ramp entry, flat floor at the depth, wall at tool radius, before the outer contour', () => {
    const p = pocketed([rectInner(40, 40, 100, 80)], 8);
    const tp = buildToolpath(p, goldenProfile('generic'));
    expect(tp.errors).toEqual([]);
    const ops = tp.toolpath.operations;
    const pocket = ops.find((o) => o.kind === 'pocket' && o.inner === 0) as Operation;
    expect(pocket).toBeDefined();
    expect(ops.indexOf(pocket)).toBeLessThan(ops.findIndex((o) => o.kind === 'outerContour'));
    // Never below the declared depth; the last pass is at it.
    const zs = trace(pocket).map((m) => m.z);
    expect(Math.min(...zs)).toBeCloseTo(-8, 9);
    expect(pocket.passDepths[pocket.passDepths.length - 1]).toBe(-8);
    // Ramp: no plunge below the material top except the re-entry down to a floor already cut.
    const plunges = moves(pocket).filter((m) => m.kind === 'plunge');
    const floors = [0, ...pocket.passDepths.slice(0, -1)];
    for (const m of plunges) expect(floors.some((z) => Math.abs(z - m.z) < 1e-9)).toBe(true);
    expect(tp.warnings.some((w) => w.code === 'POCKET_PLUNGE_ENTRY')).toBe(false);
    // Inside the opening minus the tool radius (sheet frame: + 20).
    const r = pocket.toolDiameter / 2;
    for (const m of trace(pocket).filter((q) => q.z < 0)) {
      expect(m.x).toBeGreaterThanOrEqual(60 + r - 1e-6);
      expect(m.x).toBeLessThanOrEqual(160 - r + 1e-6);
      expect(m.y).toBeGreaterThanOrEqual(60 + r - 1e-6);
      expect(m.y).toBeLessThanOrEqual(140 - r + 1e-6);
    }
    // No inner cut-out loop: the pocket is not cut through.
    expect(ops.some((o) => o.kind === 'innerContour')).toBe(false);
  });

  it('a pocket as deep as the stock (e.g. after a thickness change) blocks; validation agrees', () => {
    const p = clone(pocketed([rectInner(40, 40, 100, 80)], 8)) as Project;
    // As if the stock got thinner after the pocket was set (the command refuses it directly).
    (p.parts[0]?.ops?.inners?.[0] as { depth: number }).depth = thickness;
    const tp = buildToolpath(p, goldenProfile('generic'));
    expect(tp.errors.some((e) => e.code === 'POCKET_DEPTH_INVALID')).toBe(true);
    const v = validateProject(p, { machine: goldenProfile('generic') });
    expect(v.some((i) => i.code === 'POCKET_DEPTH_NOT_BELOW_THICKNESS')).toBe(true);
  });

  it('a pocket narrower than the tool blocks the toolpath and is an error where it is drawn', () => {
    const p = pocketed([rectInner(40, 40, 4, 80)], 5);
    expect(buildToolpath(p, goldenProfile('generic')).errors.map((e) => e.code)).toContain(
      'POCKET_TOO_SMALL',
    );
    const v = validateProject(p, { machine: goldenProfile('generic') });
    expect(v.find((i) => i.code === 'POCKET_TOO_SMALL')?.path).toBe('parts[0].inners[0]');
  });

  it('near the thickness: a warning, still cut', () => {
    const p = pocketed([rectInner(40, 40, 100, 80)], thickness - 0.5);
    const v = validateProject(p, { machine: goldenProfile('generic') });
    expect(v.some((i) => i.code === 'POCKET_DEPTH_NEAR_THICKNESS')).toBe(true);
    expect(buildToolpath(p, goldenProfile('generic')).ok).toBe(true);
  });

  it.each(['generic', 'mach3'] as const)(
    '%s: a rectangular pocket exports with no check violations',
    (post) => {
      const p = pocketed([rectInner(40, 40, 100, 80)], 6);
      const out = exportNc(p, profile(post), postConfig(post));
      expect(out.check?.violations ?? []).toEqual([]);
      expect(out.ok).toBe(true);
    },
  );

  it('property: random rectangles, depths, rotations: inside the pocket minus r, never below the depth, export passes the check', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 120 }),
        fc.integer({ min: 10, max: 90 }),
        fc.double({ min: 0.5, max: 15, noNaN: true }),
        fc.constantFrom(0, 90, 180, 270),
        (w, h, depth, rot) => {
          const p = pocketed([rectInner(30, 30, w, h)], Math.round(depth * 100) / 100, rot);
          const tp = buildToolpath(p, goldenProfile('generic'));
          const op = tp.toolpath.operations.find((o) => o.kind === 'pocket');
          const r = (op?.toolDiameter ?? 6) / 2;
          if (Math.min(w, h) < 2 * r + 1e-6) {
            expect(tp.ok).toBe(false);
            return;
          }
          expect(tp.errors).toEqual([]);
          if (!op) throw new Error('no pocket');
          const d = Math.round(depth * 100) / 100;
          const pts = trace(op).filter((m) => m.z < -1e-9);
          for (const m of pts) expect(m.z).toBeGreaterThanOrEqual(-d - 1e-9);
          // The pocket's own box in the sheet frame = the cut points' box + r on each side.
          const xs = pts.map((m) => m.x);
          const ys = pts.map((m) => m.y);
          const bw = Math.max(...xs) - Math.min(...xs) + 2 * r;
          const bh = Math.max(...ys) - Math.min(...ys) + 2 * r;
          const [ew, eh] = rot % 180 === 0 ? [w, h] : [h, w];
          expect(bw).toBeLessThanOrEqual(ew + 1e-6);
          expect(bh).toBeLessThanOrEqual(eh + 1e-6);
          // Step-over: consecutive rings at most 50 % of the tool apart (40 % by default).
          expect(CONTOUR_POCKET_DEFAULTS.stepoverFraction).toBeLessThanOrEqual(0.5);
          const out = exportNc(p, profile('generic'), postConfig('generic'));
          expect(out.check?.violations.filter((v) => v.severity === 'error') ?? []).toEqual([]);
        },
      ),
      { numRuns: 25 },
    );
  });
});
