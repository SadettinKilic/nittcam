/**
 * Tester properties for the snap engine (T126, spec §4.4, §11): the result never jumps further
 * than the tolerance, `none` leaves the point alone, disabled kinds never win, priority is
 * respected, the engine is translation-equivariant and stable on its own output, and bad input
 * (zero / NaN tolerance, NaN point) snaps nowhere instead of throwing.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Point, Vertex } from '../geometry/types';
import { snap, SNAP_PRIORITY, type SnapContext, type SnapKind } from './snap';

const rect = (x: number, y: number, w: number, h: number): Vertex[] => [
  { x, y, bulge: 0 },
  { x: x + w, y, bulge: 0 },
  { x: x + w, y: y + h, bulge: 0 },
  { x, y: y + h, bulge: 0 },
];
const circle = (cx: number, cy: number, r: number): Vertex[] => [
  { x: cx - r, y: cy, bulge: 1 },
  { x: cx + r, y: cy, bulge: 1 },
];

const int = (min: number, max: number) => fc.integer({ min, max });
const shape = fc.oneof(
  fc
    .tuple(int(-500, 500), int(-500, 500), int(20, 400), int(20, 400))
    .map(([x, y, w, h]) => rect(x, y, w, h)),
  fc.tuple(int(-500, 500), int(-500, 500), int(10, 200)).map(([x, y, r]) => circle(x, y, r)),
);
const pt = fc.record({
  x: fc.double({ min: -700, max: 900, noNaN: true, noDefaultInfinity: true }),
  y: fc.double({ min: -700, max: 900, noNaN: true, noDefaultInfinity: true }),
});
const kinds = fc.subarray([...SNAP_PRIORITY]);
const ctxArb = fc.record(
  {
    contours: fc.array(shape, { minLength: 0, maxLength: 4 }),
    centres: fc.array(pt, { maxLength: 2 }),
    tolerance: fc.double({ min: 0.5, max: 40, noNaN: true, noDefaultInfinity: true }),
    grid: fc.constantFrom(1, 10, 100),
    from: pt,
    disabled: kinds,
  },
  { requiredKeys: ['contours', 'centres', 'tolerance', 'disabled'] },
);

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const rank = (k: SnapKind) => SNAP_PRIORITY.indexOf(k as (typeof SNAP_PRIORITY)[number]);

describe('snap engine, tester properties (T126)', () => {
  it('never moves the point further than the tolerance; none leaves it unchanged', () => {
    fc.assert(
      fc.property(pt, ctxArb, (p, ctx) => {
        const r = snap(p, ctx);
        if (r.kind === 'none') expect(r.point).toEqual(p);
        else expect(dist(r.point, p)).toBeLessThanOrEqual(ctx.tolerance + 1e-9);
      }),
    );
  });

  it('a disabled kind never wins; everything disabled gives none', () => {
    fc.assert(
      fc.property(pt, ctxArb, (p, ctx) => {
        const r = snap(p, ctx);
        expect(ctx.disabled).not.toContain(r.kind);
        expect(snap(p, { ...ctx, disabled: [...SNAP_PRIORITY] }).kind).toBe('none');
      }),
    );
  });

  it('priority: switching off the winning kind never yields a higher-priority kind', () => {
    fc.assert(
      fc.property(pt, ctxArb, (p, ctx) => {
        const r = snap(p, ctx);
        if (r.kind === 'none') return;
        const r2 = snap(p, { ...ctx, disabled: [...ctx.disabled, r.kind] });
        if (r2.kind !== 'none') expect(rank(r2.kind)).toBeGreaterThan(rank(r.kind));
      }),
    );
  });

  it('is translation-equivariant (integer shift, no grid): same kind, shifted point', () => {
    fc.assert(
      fc.property(pt, ctxArb, int(-300, 300), int(-300, 300), (p, ctx, tx, ty) => {
        const c: SnapContext = { ...ctx };
        delete c.grid;
        const sh = (q: Point) => ({ x: q.x + tx, y: q.y + ty });
        const moved: SnapContext = {
          ...c,
          contours: c.contours.map((cs) => cs.map((v) => ({ ...v, ...sh(v) }))),
          centres: (c.centres ?? []).map(sh),
          ...(c.from ? { from: sh(c.from) } : {}),
        };
        // A shift can absorb a tiny offset to the start point (float): the angle lock has no ray then.
        if (c.from && dist(sh(p), sh(c.from)) < 1e-6) return;
        const a = snap(p, c);
        const b = snap(sh(p), moved);
        // Points sitting on the tolerance border may flip with float rounding: skip those.
        if (a.kind !== 'none' && Math.abs(dist(a.point, p) - c.tolerance) < 1e-6) return;
        expect(b.kind).toBe(a.kind);
        expect(dist(b.point, sh(a.point))).toBeLessThan(1e-6);
      }),
    );
  });

  it('endpoint snapping is stable: snapping the snapped point again stays put', () => {
    fc.assert(
      fc.property(pt, ctxArb, (p, ctx) => {
        const r = snap(p, ctx);
        if (r.kind !== 'endpoint') return;
        const again = snap(r.point, ctx);
        expect(again.kind).toBe('endpoint');
        expect(dist(again.point, r.point)).toBeLessThan(1e-9);
      }),
    );
  });

  it('grid snap lands on a grid node (and only when within tolerance)', () => {
    fc.assert(
      fc.property(pt, fc.constantFrom(1, 10, 100), (p, g) => {
        const r = snap(p, { contours: [], tolerance: 6, grid: g });
        const node = { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
        if (dist(node, p) <= 6) {
          expect(r.kind).toBe('grid');
          expect(r.point.x / g).toBeCloseTo(Math.round(r.point.x / g), 9);
          expect(r.point.y / g).toBeCloseTo(Math.round(r.point.y / g), 9);
        } else expect(r.kind).toBe('none');
      }),
    );
  });

  it('bad input snaps nowhere instead of throwing', () => {
    const c = [rect(0, 0, 100, 100)];
    for (const tolerance of [0, -1, Number.NaN]) {
      expect(snap({ x: 0.1, y: 0.1 }, { contours: c, tolerance }).kind).toBe('none');
    }
    expect(snap({ x: Number.NaN, y: 0 }, { contours: c, tolerance: 5, grid: 10 }).kind).toBe(
      'none',
    );
    expect(snap({ x: 3, y: 3 }, { contours: [[]], tolerance: 5 }).kind).toBe('none');
    // Degenerate one-vertex contour: still a snappable point, no crash.
    expect(snap({ x: 1, y: 1 }, { contours: [[{ x: 0, y: 0, bulge: 0 }]], tolerance: 5 })).toEqual({
      kind: 'endpoint',
      point: { x: 0, y: 0 },
    });
  });
});
