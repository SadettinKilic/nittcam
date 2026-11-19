/**
 * T142: on-line operations and per-contour operations through the toolpath, the post and the
 * independent G-code check (rule 9): an open engraving line, an outline engraved instead of cut,
 * an inner contour left uncut, depth limits and the cut order.
 */
import fc from 'fast-check';
import { applyPatches, enablePatches } from 'immer';
import { describe, expect, it } from 'vitest';
import { applyCommand } from '../commands';
import { postConfig } from '../gcode-check/check.testing';
import { exportNc } from '../export';
import { goldenProfile } from '../post/golden.testing';
import { parseProject, type Project } from '../schema';
import { validateProject } from '../validate';
import { buildToolpath } from './build';
import { clone, machineOf, projectOf } from './toolpath.testing';
import type { Move, Operation } from './types';

enablePatches();

const profile = (post: 'generic' | 'mach3') => ({
  profile: goldenProfile(post),
  version: 1,
  verification: 'draft' as const,
});

/** Part 300 × 200 with a 100 × 80 opening and the given open lines, one copy at (20, 20). */
function base(lines: unknown[] = [], rot = 0, second = false): Project {
  const p = clone(
    projectOf({
      parts: [{ id: 'a', w: 300, h: 200 }],
      placements: [[{ partId: 'a', index: 0, x: 20, y: 20, rot }]],
    }),
  ) as unknown as { parts: Record<string, unknown>[] };
  const part = p.parts[0] as Record<string, unknown>;
  part['inners'] = [
    [
      { x: 40, y: 40, bulge: 0 },
      { x: 40, y: 120, bulge: 0 },
      { x: 140, y: 120, bulge: 0 },
      { x: 140, y: 40, bulge: 0 },
    ],
  ];
  if (second) {
    (part['inners'] as unknown[]).push([
      { x: 180, y: 40, bulge: 0 },
      { x: 180, y: 120, bulge: 0 },
      { x: 260, y: 120, bulge: 0 },
      { x: 260, y: 40, bulge: 0 },
    ]);
  }
  if (lines.length > 0) part['lines'] = lines;
  const r = parseProject(p);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.project;
}

const engraving = {
  vertices: [
    { x: 180, y: 40, bulge: 0 },
    { x: 260, y: 40, bulge: 0.4 },
    { x: 260, y: 160, bulge: 0 },
  ],
  op: { kind: 'online', depth: 9 },
};

function run(p: Project, name: string, params: unknown): Project {
  const r = applyCommand(p, name, params);
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r.project;
}

const feedZ = (op: Operation) =>
  op.segments
    .flatMap((s) => s.moves)
    .filter((m: Move) => m.kind !== 'rapid')
    .map((m) => m.z);

describe('setOperation (T142)', () => {
  it('sets, replaces and clears an override; defaults are not stored; one undo step', () => {
    const p0 = base([engraving]);
    const p1 = run(p0, 'setOperation', {
      id: 'a',
      contour: { type: 'inner', index: 0 },
      kind: 'online',
      depth: 3,
    });
    expect(p1.parts[0]?.ops).toEqual({ inners: [{ kind: 'online', depth: 3 }] });
    const p2 = run(p1, 'setOperation', { id: 'a', contour: { type: 'outline' }, kind: 'none' });
    expect(p2.parts[0]?.ops).toEqual({
      outline: { kind: 'none' },
      inners: [{ kind: 'online', depth: 3 }],
    });
    const p3 = run(p2, 'setOperation', {
      id: 'a',
      contour: { type: 'inner', index: 0 },
      kind: 'inside',
    });
    const p4 = run(p3, 'setOperation', { id: 'a', contour: { type: 'outline' }, kind: 'outside' });
    expect(p4.parts[0]?.ops).toBeUndefined();
    expect(JSON.stringify(p4)).toBe(JSON.stringify(p0));
    const p5 = run(p0, 'setOperation', {
      id: 'a',
      contour: { type: 'line', index: 0 },
      kind: 'none',
    });
    expect(p5.parts[0]?.lines?.[0]?.op).toEqual({ kind: 'none' });
  });

  it('refuses kinds a contour does not allow, missing/too deep depths and unknown contours', () => {
    const p = base([engraving]);
    const bad: [unknown, RegExp][] = [
      [{ id: 'a', contour: { type: 'outline' }, kind: 'inside' }, /not allowed/],
      [{ id: 'a', contour: { type: 'inner', index: 0 }, kind: 'outside' }, /not allowed/],
      [{ id: 'a', contour: { type: 'line', index: 0 }, kind: 'outside' }, /not allowed/],
      [{ id: 'a', contour: { type: 'outline' }, kind: 'online' }, /needs a depth/],
      [
        { id: 'a', contour: { type: 'outline' }, kind: 'online', depth: 18 },
        /less than the thickness/,
      ],
      [{ id: 'a', contour: { type: 'outline' }, kind: 'none', depth: 2 }, /only an on-line/],
      [{ id: 'a', contour: { type: 'inner', index: 1 }, kind: 'none' }, /no such inner/],
      [{ id: 'a', contour: { type: 'line', index: 3 }, kind: 'none' }, /no such line/],
      [{ id: 'x', contour: { type: 'outline' }, kind: 'none' }, /no part/],
    ];
    for (const [params, why] of bad) {
      const r = applyCommand(p, 'setOperation', params);
      expect(r.ok, JSON.stringify(params)).toBe(false);
      expect(JSON.stringify(r)).toMatch(why);
    }
  });

  it('property: apply then undo (inverse patches) restores the project byte for byte', () => {
    const p = base([engraving]);
    fc.assert(
      fc.property(
        fc.constantFrom<unknown>(
          { type: 'outline' },
          { type: 'inner', index: 0 },
          { type: 'line', index: 0 },
        ),
        fc.constantFrom('outside', 'inside', 'online', 'none'),
        fc.double({ min: 0.1, max: 17.9, noNaN: true }),
        (contour, kind, depth) => {
          const params = { id: 'a', contour, kind, ...(kind === 'online' ? { depth } : {}) };
          const r = applyCommand(p, 'setOperation', params);
          if (!r.ok) return;
          // undo = applying the inverse patches
          expect(JSON.stringify(applyPatches(r.project, r.inversePatches))).toBe(JSON.stringify(p));
        },
      ),
      { numRuns: 60 },
    );
  });

  it('removing an inner contour keeps the remaining overrides with their contours', () => {
    let p = base([], 0, true);
    p = run(p, 'setOperation', { id: 'a', contour: { type: 'inner', index: 1 }, kind: 'none' });
    expect(p.parts[0]?.ops).toEqual({ inners: [null, { kind: 'none' }] });
    p = run(p, 'removeInnerContour', { id: 'a', index: 0 });
    expect(p.parts[0]?.ops).toEqual({ inners: [{ kind: 'none' }] });
    p = run(p, 'removeInnerContour', { id: 'a', index: 0 });
    expect(p.parts[0]?.ops).toBeUndefined();
  });
});

describe('on-line operations in the toolpath (T142)', () => {
  it('open line: tool centre on the line, back and forth per pass, never below its depth; before the through cuts', () => {
    const res = buildToolpath(base([engraving]), goldenProfile('generic'));
    expect(res.errors).toEqual([]);
    const ops = res.toolpath.operations;
    const line = ops.find((o) => o.id === 'a#0/line0');
    if (!line) throw new Error('no line op');
    expect(line.kind).toBe('online');
    expect(line.tabs).toEqual([]);
    expect(Math.min(...feedZ(line))).toBeCloseTo(-9, 9);
    expect(line.passDepths.at(-1)).toBe(-9);
    // Tool centre on the line: the first pass ends at the last vertex (sheet frame: +20, +20).
    const pass0 = line.segments.find((s) => s.role === 'pass' && s.pass === 0);
    const end0 = pass0?.moves.at(-1);
    expect(end0).toMatchObject({ x: 280, y: 180 });
    expect(line.segments[0]?.moves[0]).toMatchObject({ kind: 'rapid', x: 200, y: 60 });
    const iLine = ops.indexOf(line);
    expect(iLine).toBeLessThan(ops.findIndex((o) => o.kind === 'innerContour'));
    expect(iLine).toBeLessThan(ops.findIndex((o) => o.kind === 'outerContour'));
  });

  it.each(['generic', 'mach3'] as const)(
    '%s: open line, engraved outline and uncut inner export with no check violations',
    (post) => {
      let p = base([engraving]);
      p = run(p, 'setOperation', {
        id: 'a',
        contour: { type: 'inner', index: 0 },
        kind: 'online',
        depth: 2,
      });
      const cutOut = exportNc(p, profile(post), postConfig(post));
      expect(cutOut.check?.violations ?? []).toEqual([]);
      expect(cutOut.ok).toBe(true);
      p = run(p, 'setOperation', {
        id: 'a',
        contour: { type: 'outline' },
        kind: 'online',
        depth: 1,
      });
      const engraved = exportNc(p, profile(post), postConfig(post));
      expect(engraved.check?.violations ?? []).toEqual([]);
      expect(engraved.ok).toBe(true);
      p = run(p, 'setOperation', { id: 'a', contour: { type: 'inner', index: 0 }, kind: 'none' });
      const tp = buildToolpath(p, goldenProfile(post));
      expect(tp.toolpath.operations.map((o) => o.kind).sort()).toEqual(['online', 'online']);
      expect(exportNc(p, profile(post), postConfig(post)).ok).toBe(true);
    },
  );

  it('an inner contour too small for the tool is fine when it is engraved, not cut', () => {
    const p = base();
    const tiny = clone(p) as unknown as { parts: { inners: unknown[]; ops?: unknown }[] };
    const part = tiny.parts[0];
    if (!part) throw new Error('fixture');
    part.inners = [
      [
        { x: 50, y: 50, bulge: 0 },
        { x: 50, y: 53, bulge: 0 },
        { x: 53, y: 53, bulge: 0 },
        { x: 53, y: 50, bulge: 0 },
      ],
    ];
    const cut = parseProject(tiny);
    if (!cut.ok) throw new Error('fixture');
    expect(
      buildToolpath(cut.project, goldenProfile('generic')).errors.map((e) => e.code),
    ).toContain('INNER_OFFSET_FAILED');
    part.ops = { inners: [{ kind: 'online', depth: 1 }] };
    const engraved = parseProject(tiny);
    if (!engraved.ok) throw new Error('fixture');
    expect(buildToolpath(engraved.project, goldenProfile('generic')).errors).toEqual([]);
  });

  it('depth never reaches the thickness: a too deep on-line op (e.g. after a thickness change) blocks', () => {
    const p = run(base([engraving]), 'setThickness', { thickness: 8 });
    const res = buildToolpath(p, machineOf({ thickness: 8 }));
    expect(res.ok).toBe(false);
    expect(res.errors.map((e) => e.code)).toContain('ONLINE_DEPTH_INVALID');
  });

  it('property: any rotation; every on-line move stays between the top and its depth', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(0, 90, 180, 270),
        fc.double({ min: 0.5, max: 17, noNaN: true }),
        (rot, depth) => {
          const p = base([{ ...engraving, op: { kind: 'online', depth } }], rot);
          const res = buildToolpath(p, goldenProfile('generic'));
          expect(res.errors).toEqual([]);
          const line = res.toolpath.operations.find((o) => o.kind === 'online') as Operation;
          for (const z of feedZ(line)) {
            expect(z).toBeLessThan(0);
            expect(z).toBeGreaterThanOrEqual(-depth - 1e-9);
          }
          expect(res.toolpath.targetDepth).toBeLessThan(-depth);
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe('T277: an open line stays inside its part (tool radius included)', () => {
  const line = (x0: number, x1: number, y = 100) => ({
    vertices: [
      { x: x0, y, bulge: 0 },
      { x: x1, y, bulge: 0 },
    ],
    op: { kind: 'online', depth: 1 },
  });
  const lineErrors = (p: Project) =>
    buildToolpath(p, machineOf())
      .errors.filter((e) => e.code === 'LINE_OUTSIDE_PART')
      .map((e) => e.openLine);
  const flagged = (p: Project) =>
    validateProject(p, { machine: machineOf() })
      .filter((i) => i.code === 'LINE_OUTSIDE_PART')
      .map((i) => i.path);

  it('a line past the 300 mm part (B15 tester case) is refused by the validation and the toolpath', () => {
    const p = base([line(100, 600, 180)]);
    expect(lineErrors(p)).toEqual([0]);
    expect(flagged(p)).toEqual(['parts[0].lines[0]']);
  });

  it('a line that crosses the outline by 0.1 mm, or whose groove does, is refused', () => {
    expect(lineErrors(base([line(200, 300.1, 180)]))).toEqual([0]);
    // Ends 1 mm from the edge: the Ø8 (or Ø6) tool groove reaches past it.
    expect(lineErrors(base([line(200, 299, 180)]))).toEqual([0]);
  });

  it('a line well inside passes; a line with operation none is not checked', () => {
    expect(lineErrors(base([line(160, 280, 180)]))).toEqual([]);
    expect(flagged(base([line(160, 280, 180)]))).toEqual([]);
    const off = { ...line(100, 600, 180), op: { kind: 'none' } };
    expect(lineErrors(base([off]))).toEqual([]);
    expect(flagged(base([off]))).toEqual([]);
  });
});
