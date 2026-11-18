import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EPS } from '../geometry/constants';
import type { Point, Vertex } from '../geometry/types';
import { snap, type SnapContext } from './snap';

const rect = (x: number, y: number, w: number, h: number): Vertex[] => [
  { x, y, bulge: 0 },
  { x: x + w, y, bulge: 0 },
  { x: x + w, y: y + h, bulge: 0 },
  { x, y: y + h, bulge: 0 },
];
/** Full circle as two half arcs (bulge 1). */
const circle = (cx: number, cy: number, r: number): Vertex[] => [
  { x: cx - r, y: cy, bulge: 1 },
  { x: cx + r, y: cy, bulge: 1 },
];

const near = (p: Point, q: Point) => Math.hypot(p.x - q.x, p.y - q.y);
const coord = fc.double({ min: -2000, max: 2000, noNaN: true, noDefaultInfinity: true });
const side = fc.double({ min: 50, max: 1500, noNaN: true, noDefaultInfinity: true });
const unit = fc.double({ min: -1, max: 1, noNaN: true, noDefaultInfinity: true });

describe('snap engine (T126)', () => {
  it('endpoint: a point within tolerance of a corner lands exactly on it', () => {
    fc.assert(
      fc.property(coord, coord, side, side, fc.nat(3), unit, unit, (x, y, w, h, k, ox, oy) => {
        const tol = 5;
        const vs = rect(x, y, w, h);
        const target = vs[k] as Vertex;
        const len = Math.hypot(ox, oy) || 1;
        const r = Math.min(1, Math.hypot(ox, oy)) * tol * 0.99;
        const p = { x: target.x + (ox / len) * r, y: target.y + (oy / len) * r };
        const res = snap(p, { contours: [vs], tolerance: tol });
        expect(res.kind).toBe('endpoint');
        expect(near(res.point, target)).toBeLessThan(EPS);
      }),
    );
  });

  it('never moves a point by more than the tolerance; outside it the point stays', () => {
    fc.assert(
      fc.property(
        coord,
        coord,
        side,
        side,
        coord,
        coord,
        fc.double({ min: 0.5, max: 40, noNaN: true }),
        fc.option(fc.constantFrom(1, 10, 100), { nil: undefined }),
        fc.option(fc.record({ x: coord, y: coord }), { nil: undefined }),
        (x, y, w, h, px, py, tol, grid, from) => {
          const ctx: SnapContext = {
            contours: [rect(x, y, w, h), circle(x + w / 2, y + h / 2, Math.min(w, h) / 3)],
            tolerance: tol,
            ...(grid !== undefined ? { grid } : {}),
            ...(from ? { from } : {}),
          };
          const p = { x: px, y: py };
          const res = snap(p, ctx);
          expect(near(res.point, p)).toBeLessThanOrEqual(tol + EPS);
          if (res.kind === 'none') expect(res.point).toEqual(p);
        },
      ),
    );
  });

  it('no snap outside tolerance: far from every target gives none', () => {
    fc.assert(
      fc.property(coord, coord, side, side, (x, y, w, h) => {
        // The centre of a large rectangle is far from its corners, edge midpoints and edges.
        const p = { x: x + w / 2, y: y + h / 2 };
        const tol = Math.min(w, h) / 4;
        const res = snap(p, { contours: [rect(x, y, w, h)], tolerance: tol });
        expect(res).toEqual({ kind: 'none', point: p });
      }),
    );
  });

  it('midpoint of a line and centre of an arc', () => {
    const vs = rect(0, 0, 400, 200);
    expect(snap({ x: 201, y: 1 }, { contours: [vs], tolerance: 4 })).toEqual({
      kind: 'midpoint',
      point: { x: 200, y: 0 },
    });
    const c = snap({ x: 502, y: 499 }, { contours: [circle(500, 500, 100)], tolerance: 5 });
    expect(c.kind).toBe('centre');
    expect(near(c.point, { x: 500, y: 500 })).toBeLessThan(EPS);
    const hole = snap(
      { x: 52, y: 51 },
      { contours: [], centres: [{ x: 50, y: 50 }], tolerance: 4 },
    );
    expect(hole).toEqual({ kind: 'centre', point: { x: 50, y: 50 } });
  });

  it('intersection of two crossing contours (line–line and line–arc)', () => {
    const a = rect(0, 0, 100, 100);
    const b = rect(50, 50, 100, 100);
    const res = snap({ x: 101, y: 51 }, { contours: [a, b], tolerance: 4 });
    expect(res.kind).toBe('intersection');
    expect(near(res.point, { x: 100, y: 50 })).toBeLessThan(EPS);
    // Top edge y = 50 of the square meets the circle (centre 100,0, r 60) at x = 100 − √1100.
    const x = 100 - Math.sqrt(1100);
    const arcHit = snap(
      { x: x + 1, y: 51 },
      { contours: [rect(0, -50, 100, 100), circle(100, 0, 60)], tolerance: 3 },
    );
    expect(arcHit.kind).toBe('intersection');
    expect(near(arcHit.point, { x, y: 50 })).toBeLessThan(EPS);
  });

  it('perpendicular foot from the operation start', () => {
    const res = snap(
      { x: 60, y: 2 },
      {
        contours: [rect(0, 0, 200, 100)],
        tolerance: 4,
        from: { x: 60, y: -300 },
        disabled: ['grid'],
      },
    );
    expect(res).toEqual({ kind: 'perpendicular', point: { x: 60, y: 0 } });
  });

  it('45° / 90° angle lock from the start point', () => {
    fc.assert(
      fc.property(
        coord,
        coord,
        fc.integer({ min: 0, max: 7 }),
        fc.double({ min: 20, max: 1000, noNaN: true }),
        fc.double({ min: -2, max: 2, noNaN: true }),
        (fx, fy, k, len, wobble) => {
          const ang = (k * Math.PI) / 4;
          const from = { x: fx, y: fy };
          const p = {
            x: fx + Math.cos(ang) * len - Math.sin(ang) * wobble,
            y: fy + Math.sin(ang) * len + Math.cos(ang) * wobble,
          };
          const res = snap(p, { contours: [], tolerance: 3, from });
          expect(res.kind).toBe('angle');
          const got = Math.atan2(res.point.y - fy, res.point.x - fx);
          const diff = Math.abs(Math.atan2(Math.sin(got - ang), Math.cos(got - ang)));
          expect(diff).toBeLessThan(1e-9);
        },
      ),
    );
    // Exactly vertical: no floating dust on x.
    const v = snap({ x: 1.2, y: 80 }, { contours: [], tolerance: 3, from: { x: 0, y: 0 } });
    expect(v).toEqual({ kind: 'angle', point: { x: 0, y: 80 } });
  });

  it('grid snaps to the nearest node within tolerance', () => {
    fc.assert(
      fc.property(coord, coord, fc.constantFrom(1, 10, 100), (x, y, g) => {
        const res = snap({ x, y }, { contours: [], tolerance: g, grid: g });
        expect(res.kind).toBe('grid');
        expect(Math.abs(res.point.x - Math.round(x / g) * g)).toBeLessThan(EPS);
        expect(Math.abs(res.point.y - Math.round(y / g) * g)).toBeLessThan(EPS);
      }),
    );
  });

  it('priority: an endpoint beats the grid; a disabled kind is skipped', () => {
    const ctx: SnapContext = { contours: [rect(3, 3, 100, 100)], tolerance: 8, grid: 10 };
    expect(snap({ x: 6, y: 6 }, ctx).kind).toBe('endpoint');
    expect(snap({ x: 6, y: 6 }, { ...ctx, disabled: ['endpoint'] })).toEqual({
      kind: 'grid',
      point: { x: 10, y: 10 },
    });
    expect(snap({ x: 5, y: 5 }, { ...ctx, tolerance: 0 }).kind).toBe('none');
  });
});
