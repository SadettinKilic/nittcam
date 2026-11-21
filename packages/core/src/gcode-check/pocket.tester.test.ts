/* eslint-disable @typescript-eslint/no-non-null-assertion -- tests index known results */
/**
 * Tester edge cases for contour pockets (T325, PR #180, D-113): the generator against random
 * shapes / tools / step-downs / rotations / split files, and the independent check against
 * hand-edited programs (a move 0.5 mm outside, 0.2 mm deeper, a pocket left uncleared).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { exportNc } from '../export';
import { sampleSegment } from '../geometry/segment';
import { forEachSegment } from '../geometry/polyline';
import { contour } from '../geometry/polyline';
import type { Polyline } from '../geometry/types';
import type { MachineProfile } from '../machine';
import { nestProject, nestingEngineOf } from '../nesting';
import { goldenProfile } from '../post/golden.testing';
import { parseProject, type Project } from '../schema';
import { buildToolpath, placedInners } from '../toolpath';
import { clone, projectOf } from '../toolpath/toolpath.testing';
import type { Move, Operation } from '../toolpath/types';
import { checkGcodeFiles } from './check';
import { postConfig } from './check.testing';
import { expectedLayouts } from './layout';

type V = { x: number; y: number; bulge: number };
type XY = { x: number; y: number };
const Q = Math.tan(Math.PI / 8); // bulge of a 90° arc

const rect = (x0: number, y0: number, w: number, h: number): V[] => [
  { x: x0, y: y0, bulge: 0 },
  { x: x0 + w, y: y0, bulge: 0 },
  { x: x0 + w, y: y0 + h, bulge: 0 },
  { x: x0, y: y0 + h, bulge: 0 },
];
/** CCW rounded rectangle, corner radius rr (< min(w, h) / 2). */
const roundRect = (x0: number, y0: number, w: number, h: number, rr: number): V[] => [
  { x: x0 + rr, y: y0, bulge: 0 },
  { x: x0 + w - rr, y: y0, bulge: Q },
  { x: x0 + w, y: y0 + rr, bulge: 0 },
  { x: x0 + w, y: y0 + h - rr, bulge: Q },
  { x: x0 + w - rr, y: y0 + h, bulge: 0 },
  { x: x0 + rr, y: y0 + h, bulge: Q },
  { x: x0, y: y0 + h - rr, bulge: 0 },
  { x: x0, y: y0 + rr, bulge: Q },
];
/** CCW L-shape: arms of width t along the bottom and the left side. */
const lShape = (x0: number, y0: number, w: number, h: number, t: number): V[] => [
  { x: x0, y: y0, bulge: 0 },
  { x: x0 + w, y: y0, bulge: 0 },
  { x: x0 + w, y: y0 + t, bulge: 0 },
  { x: x0 + t, y: y0 + t, bulge: 0 },
  { x: x0 + t, y: y0 + h, bulge: 0 },
  { x: x0, y: y0 + h, bulge: 0 },
];

interface Opts {
  rot?: number;
  band?: number;
  hole?: { cx: number; cy: number; d: number };
}

/** Part 300 × 200 at (20, 20) on the sheet; inner 0 is a pocket of `depth`. */
function pocketProject(inner: V[], depth: number, o: Opts = {}): Project {
  const p = clone(
    projectOf({
      parts: [{ id: 'a', w: 300, h: 200 }],
      placements: [[{ partId: 'a', index: 0, x: 20, y: 20, rot: o.rot ?? 0 }]],
    }),
  ) as unknown as { parts: Record<string, unknown>[] };
  const part = p.parts[0]!;
  part['inners'] = [inner];
  part['ops'] = { inners: [{ kind: 'pocket', depth }] };
  if (o.band) part['edgeBand'] = { top: 0, right: 0, bottom: o.band, left: o.band };
  if (o.hole) part['holes'] = [{ id: 'h', type: 'through', tool: 1, ...o.hole }];
  const r = parseProject(p);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.project;
}

/** The golden profile with the set's tool (T2) at Ø `d` and the given step-down. */
function profileWith(post: 'generic' | 'mach3', d: number, stepDown: number): MachineProfile {
  const p = structuredClone(goldenProfile(post));
  p.tools = p.tools.map((t) => (t.number === 2 ? { ...t, diameter: d, fluteLength: 40 } : t));
  p.materials = p.materials.map((m) => ({ ...m, stepDown }));
  return p;
}

const pv = (profile: MachineProfile) => ({ profile, version: 1, verification: 'draft' as const });
const movesOf = (op: Operation): Move[] => op.segments.flatMap((s) => s.moves);

/** Closed contour → polygon (arcs sampled finely). */
function polygon(pl: Polyline): XY[] {
  const out: XY[] = [];
  forEachSegment(pl, (a, b, bulge) => {
    const n = bulge === 0 ? 1 : 64;
    out.push(...sampleSegment(a, b, bulge, n).slice(0, -1));
  });
  return out;
}
function inside(p: XY, poly: readonly XY[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
function segDist(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function edgeDist(p: XY, poly: readonly XY[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    best = Math.min(best, segDist(p, poly[i]!, poly[(i + 1) % poly.length]!));
  }
  return best;
}

/** The tool centre path of an operation as 3D polylines (arcs sampled), cutting moves only. */
function centrePath(op: Operation): { a: XY & { z: number }; b: XY & { z: number }; m: Move }[] {
  const out: { a: XY & { z: number }; b: XY & { z: number }; m: Move }[] = [];
  let prev: (XY & { z: number }) | null = null;
  for (const m of movesOf(op)) {
    const to = { x: m.x, y: m.y, z: m.z };
    if (prev && m.kind !== 'rapid') {
      if (m.kind === 'arc') {
        const pts = sampleSegment(prev, to, m.bulge, 32);
        for (let i = 0; i + 1 < pts.length; i++) {
          const z0 = prev.z + ((to.z - prev.z) * i) / 32;
          const z1 = prev.z + ((to.z - prev.z) * (i + 1)) / 32;
          out.push({ a: { ...pts[i]!, z: z0 }, b: { ...pts[i + 1]!, z: z1 }, m });
        }
      } else out.push({ a: prev, b: to, m });
    }
    prev = to;
  }
  return out;
}

const SHAPES = fc.oneof(
  fc
    .record({ w: fc.integer({ min: 8, max: 200 }), h: fc.integer({ min: 8, max: 140 }) })
    .map(({ w, h }) => ({ name: `rect ${w}x${h}`, v: rect(40, 30, w, h) })),
  fc
    .record({
      w: fc.integer({ min: 20, max: 200 }),
      h: fc.integer({ min: 20, max: 140 }),
      k: fc.double({ min: 0.05, max: 0.49, noNaN: true }),
    })
    .map(({ w, h, k }) => {
      const rr = Math.round(Math.min(w, h) * k * 10) / 10;
      return { name: `round ${w}x${h} R${rr}`, v: roundRect(40, 30, w, h, rr) };
    }),
  fc
    .record({
      w: fc.integer({ min: 30, max: 200 }),
      h: fc.integer({ min: 30, max: 140 }),
      t: fc.integer({ min: 8, max: 29 }),
    })
    .map(({ w, h, t }) => ({ name: `L ${w}x${h} t${t}`, v: lShape(40, 30, w, h, t) })),
);

describe('contour pocket generator, random shapes × tools Ø3–Ø12 × passes (T325 tester)', () => {
  it('property: refused cleanly or: inside boundary − r, never below the depth, floor fully cleared, ramp ≤ 3°, export (generic + mach3) passes', () => {
    fc.assert(
      fc.property(
        SHAPES,
        fc.constantFrom(3, 4, 6, 8, 10, 12),
        fc.constantFrom(2, 3.5, 6),
        fc.integer({ min: 5, max: 160 }).map((x) => x / 10),
        fc.constantFrom(0, 90, 180, 270),
        fc.constantFrom('generic', 'mach3') as fc.Arbitrary<'generic' | 'mach3'>,
        fc.constantFrom(0, 2),
        (shape, d, stepDown, depth, rot, post, band) => {
          const project = pocketProject(shape.v, depth, { rot, band });
          const profile = profileWith(post, d, stepDown);
          const tp = buildToolpath(project, profile);
          const codes = tp.errors.map((e) => e.code);
          if (!tp.ok) {
            // Only the pocket refusals are acceptable here.
            expect(codes.every((c) => c === 'POCKET_TOO_SMALL' || c === 'POCKET_SPLIT')).toBe(true);
            return;
          }
          const op = tp.toolpath.operations.find((o) => o.kind === 'pocket')!;
          const r = d / 2;
          const placed = placedInners(project.parts[0]!, project.layout.sheets[0]!.placements[0]!);
          const poly = polygon(placed[0]!);
          const path = centrePath(op);
          for (const s of path) {
            for (const q of [s.a, s.b]) {
              if (q.z >= 0) continue;
              expect(q.z, shape.name).toBeGreaterThanOrEqual(-depth - 1e-9);
              expect(inside(q, poly), shape.name).toBe(true);
              expect(edgeDist(q, poly), shape.name).toBeGreaterThanOrEqual(r - 1e-3);
            }
            // Ramp: a sloped XY move descends at most 3° (spec: ≤ 3°, more laps when needed).
            const xy = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
            const dz = s.a.z - s.b.z;
            if (s.m.kind !== 'plunge' && xy > 1e-6 && dz > 1e-9) {
              const deg = (Math.atan2(dz, xy) * 180) / Math.PI;
              expect(deg, `${shape.name} Ø${d} depth ${depth}`).toBeLessThanOrEqual(3 + 1e-6);
            }
          }
          // Floor cleared: every point at least r from the wall is within r of the floor path.
          const floor = path.filter(
            (s) => Math.abs(s.a.z + depth) < 1e-9 && Math.abs(s.b.z + depth) < 1e-9,
          );
          const xs = poly.map((p) => p.x);
          const ys = poly.map((p) => p.y);
          const step = Math.max(0.5, r / 2);
          for (let x = Math.min(...xs); x <= Math.max(...xs); x += step) {
            for (let y = Math.min(...ys); y <= Math.max(...ys); y += step) {
              const p = { x, y };
              if (!inside(p, poly) || edgeDist(p, poly) < r + 0.05) continue;
              const near = Math.min(...floor.map((s) => segDist(p, s.a, s.b)));
              expect(near, `${shape.name} Ø${d}: (${x}, ${y}) not cleared`).toBeLessThanOrEqual(
                r + 1e-3,
              );
            }
          }
          const out = exportNc(project, pv(profile), postConfig(post));
          expect(out.check?.violations.filter((v) => v.severity === 'error') ?? []).toEqual([]);
          expect(out.ok).toBe(true);
        },
      ),
      { numRuns: 60, seed: 180 },
    );
  });

  it.each([
    [10, 6],
    [11, 6],
    [10.5, 10],
  ])(
    'ramp ≤ 3° on a short entry ring too (square %s mm, depth %s, Ø8, step-down 6): else a plunge with POCKET_PLUNGE_ENTRY',
    (w, depth) => {
      const project = pocketProject(rect(40, 40, w, w), depth);
      const tp = buildToolpath(project, profileWith('generic', 8, 6));
      expect(tp.ok).toBe(true);
      const op = tp.toolpath.operations.find((o) => o.kind === 'pocket')!;
      const plunged = tp.warnings.some((x) => x.code === 'POCKET_PLUNGE_ENTRY');
      let worst = 0;
      for (const s of centrePath(op)) {
        const xy = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
        const dz = s.a.z - s.b.z;
        if (s.m.kind !== 'plunge' && xy > 1e-6 && dz > 1e-9) {
          worst = Math.max(worst, (Math.atan2(dz, xy) * 180) / Math.PI);
        }
      }
      if (!plunged) expect(worst).toBeLessThanOrEqual(3 + 1e-6);
      if (w === 10) expect(plunged).toBe(true);
    },
  );

  it('split files: a pocket job split into several files passes, the pocket counts as cleared across them', () => {
    const project = pocketProject(rect(40, 40, 100, 80), 5);
    const profile = goldenProfile('generic');
    const cfg = postConfig('generic');
    const whole = exportNc(project, pv(profile), cfg);
    expect(whole.ok).toBe(true);
    expect(whole.files).toHaveLength(1);
    cfg.file.maxSizeBytes = 2000;
    const split = exportNc(project, pv(profile), cfg);
    expect(split.files.length).toBeGreaterThan(1);
    expect(split.check?.violations.filter((v) => v.severity === 'error') ?? []).toEqual([]);
    expect(split.ok).toBe(true);
  });
});

describe('independent check against hand-edited NC (T325 tester)', () => {
  // Pocket 100 × 80 at part (40, 40), part at (20, 20): sheet box 60..160 × 60..140, Ø8 (T2).
  const project = pocketProject(rect(40, 40, 100, 80), 5);
  const profile = goldenProfile('generic');
  const cfg = postConfig('generic');
  const tp = buildToolpath(project, profile);
  const context = {
    profile,
    verification: 'draft' as const,
    post: cfg,
    toolpath: tp.toolpath,
    stock: { thickness: 18, sheetWidth: 2440, sheetHeight: 1220 },
    layout: expectedLayouts(project, tp.toolpath.operations[0]?.toolDiameter ?? 0),
  };
  const out = exportNc(project, pv(profile), cfg);
  const file = out.files[0]!;
  const lines = file.content.split(/\r?\n/);
  const check = (content: string) => checkGcodeFiles([{ ...file, content }], context);
  const codes = (content: string) => check(content).violations.map((v) => v.code);
  /** Index of the first line whose X word equals `x` (wall ring at 156 = 160 − r). */
  const lineWithX = (x: number) =>
    lines.findIndex((l) => new RegExp(`X${x}(\\.0+)?(?!\\d)`).test(l));

  it('baseline: the generated file passes', () => {
    expect(out.ok).toBe(true);
    expect(check(file.content).ok).toBe(true);
  });

  it('one wall move 0.5 mm outside (inside the pocket, closer than r to the wall) is refused', () => {
    const i = lineWithX(156);
    expect(i).toBeGreaterThan(0);
    const edited = [...lines];
    edited[i] = edited[i]!.replace(/X156(\.0+)?/, 'X156.5');
    const res = check(edited.join('\n'));
    expect(res.ok).toBe(false);
    expect(res.violations.map((v) => v.code)).toContain('POCKET_OUTSIDE_BOUNDARY');
  });

  it('the whole wall side moved past the boundary (+6 mm) is refused', () => {
    const edited = lines.map((l) => l.replace(/X156(\.0+)?(?!\d)/, 'X166.000'));
    const res = check(edited.join('\n'));
    expect(res.ok).toBe(false);
    expect(res.violations.map((v) => v.code)).toContain('POCKET_OUTSIDE_BOUNDARY');
  });

  it('0.2 mm deeper on one floor block is refused (POCKET_TOO_DEEP)', () => {
    const i = lines.findIndex((l) => /Z-5(\.0+)?(?!\d)/.test(l) && /^G0?1/.test(l.trim()));
    expect(i).toBeGreaterThan(0);
    const edited = [...lines];
    edited[i] = edited[i]!.replace(/Z-5(\.0+)?/, 'Z-5.200');
    expect(codes(edited.join('\n'))).toContain('POCKET_TOO_DEEP');
  });

  it('0.2 mm shallower everywhere: the pocket is left uncut (POCKET_NOT_CUT)', () => {
    const edited = file.content.replace(/Z-5(\.0+)?(?!\d)/g, 'Z-4.800');
    expect(codes(edited)).toContain('POCKET_NOT_CUT');
  });

  /** Lines kept after dropping every XY feed block whose modal end point satisfies `drop`. */
  function dropFeeds(drop: (x: number, y: number) => boolean): string[] {
    let x = NaN;
    let y = NaN;
    return lines.filter((l) => {
      const mx = /X(-?[\d.]+)/.exec(l);
      const my = /Y(-?[\d.]+)/.exec(l);
      if (mx) x = Number(mx[1]);
      if (my) y = Number(my[1]);
      if (!/^G0?[123]\b/.test(l.trim()) || (!mx && !my)) return true;
      return !drop(x, y);
    });
  }

  it('pocket left uncleared: only the wall ring kept, ramp + inner rings deleted, is refused', () => {
    const kept = dropFeeds((x, y) => x > 64.5 && x < 155.5 && y > 64.5 && y < 135.5);
    expect(kept.length).toBeLessThan(lines.length - 20);
    expect(check(kept.join('\n')).ok).toBe(false);
    expect(codes(kept.join('\n'))).toContain('MODEL_MISMATCH');
  });

  it('middle rings deleted but the floor still reached (entry + wall kept): refused by the model match', () => {
    // Rings between the entry ring (|x − 110| ≤ 10.8) and the wall ring (x 64 / 156).
    const kept = dropFeeds((x, y) => {
      const ring = Math.max(Math.abs(x - 110) - 10.8, Math.abs(y - 100) - 0.8);
      return ring > 0.5 && x > 64.5 && x < 155.5 && y > 64.5 && y < 135.5;
    });
    expect(kept.length).toBeLessThan(lines.length - 10);
    const c = codes(kept.join('\n'));
    expect(c).not.toContain('POCKET_NOT_CUT');
    expect(check(kept.join('\n')).ok).toBe(false);
  });

  it('every pocket move deleted: refused (POCKET_NOT_CUT)', () => {
    const kept = dropFeeds((x, y) => x >= 63 && x <= 157 && y >= 63 && y <= 137);
    expect(kept.length).toBeLessThan(lines.length - 20);
    expect(check(kept.join('\n')).ok).toBe(false);
    expect(codes(kept.join('\n'))).toContain('POCKET_NOT_CUT');
  });
});

describe('part-in-part nesting keeps pockets / engraved contours as material (T325 side fix)', () => {
  function host(op: Record<string, unknown> | null) {
    const base = {
      grain: { mode: 'free', angle: 0 },
      kind: 'rect',
      holes: [],
      templates: [],
      edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
    };
    const parsed = parseProject({
      schemaVersion: 2,
      machine: { machineId: 'm', profileVersion: 1 },
      stock: {
        material: 'mdf',
        thickness: 18,
        sheet: { width: 640, height: 540, grain: 0 },
        useOffcuts: false,
      },
      parts: [
        {
          ...base,
          id: 'host',
          name: 'host',
          qty: 1,
          params: { w: 600, h: 500, r: 0 },
          inners: [rect(100, 100, 400, 300)],
          ...(op ? { ops: { inners: [op] } } : {}),
        },
        { ...base, id: 'g', name: 'g', qty: 4, params: { w: 100, h: 100, r: 0 }, inners: [] },
      ],
      nesting: { mode: 'minWaste', gap: 4, margin: 12, partInHole: true },
      layout: { sheets: [] },
      cutting: { tabs: { auto: false }, leadIn: 'line', direction: 'climb' },
    });
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues));
    const project = {
      ...parsed.project,
      layout: nestProject(parsed.project, { toolDiameter: 8 }).layout,
    };
    const sheetOfHost = project.layout.sheets.findIndex((s) =>
      s.placements.some((p) => p.partId === 'host'),
    );
    const guestsWithHost = project.layout.sheets[sheetOfHost]!.placements.filter(
      (p) => p.partId === 'g',
    ).length;
    return { project, guestsWithHost };
  }

  it('control: a through inner cut takes guests', () => {
    expect(host(null).guestsWithHost).toBeGreaterThan(0);
  });

  it.each([
    ['pocket', { kind: 'pocket', depth: 6 }],
    ['engraved', { kind: 'online', depth: 2 }],
    ['uncut', { kind: 'none' }],
  ])('%s inner contour: no guest nested inside, rectangle engine', (_, op) => {
    const { project, guestsWithHost } = host(op);
    expect(guestsWithHost).toBe(0);
    expect(nestingEngineOf(project)).toBe('maxrects');
  });
});

describe('pocket with a through hole drilled in its floor (T325 tester)', () => {
  it('is refused up front at the toolpath stage (islands are out of scope), never a G-code file', () => {
    const project = pocketProject(rect(40, 40, 100, 80), 5, { hole: { cx: 90, cy: 80, d: 8 } });
    const out = exportNc(project, pv(goldenProfile('generic')), postConfig('generic'));
    expect(out.ok).toBe(false);
    expect(out.stage).toBe('toolpath');
    expect(out.files).toEqual([]);
  });
});

// Keep the contour import used (shape sanity: every generated shape is a valid closed contour).
it('shape builders produce closed contours', () => {
  for (const v of [rect(0, 0, 10, 10), roundRect(0, 0, 40, 30, 5), lShape(0, 0, 40, 40, 10)]) {
    expect(contour(v).closed).toBe(true);
  }
});
