/**
 * T113: rotation by any angle (D-034). Bulges are unchanged (arcs stay arcs), area, length and
 * direction are invariant, quarter turns stay exact, and the arc-aware bbox of a rotated outline
 * contains every sampled point of the rotated contour.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { rectOutline } from '../schema/outline';
import { EPS } from './constants';
import { bbox, contour, forEachSegment, length, orientation, signedArea } from './polyline';
import { sampleSegment } from './segment';
import { isQuarterTurn, rotate, rotatePoint, rotatePointBy, transform } from './transform';
import type { Polyline } from './types';

const finite = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true }).map((v) => (v === 0 ? 0 : v));

/** Any angle with up to 3 decimals, as placements store it. */
const angle = fc.integer({ min: 0, max: 359_999 }).map((n) => n / 1000);

/** Rounded rectangle (quarter arcs), CCW. */
const roundedRect = fc
  .record({ w: finite(1, 3000), h: finite(1, 3000), k: finite(0, 1) })
  .map(({ w, h, k }) => contour(rectOutline({ w, h, r: (k * Math.min(w, h)) / 2 })));

/** A circle as two half arcs (bulge 1) of radius r around (cx, cy). */
const circle = fc
  .record({ r: finite(1, 500), cx: finite(-500, 500), cy: finite(-500, 500) })
  .map(({ r, cx, cy }): Polyline => ({
    closed: true,
    vertices: [
      { x: cx - r, y: cy, bulge: 1 },
      { x: cx + r, y: cy, bulge: 1 },
    ],
  }));

const shape = fc.oneof(roundedRect, circle);
const rel = (a: number, b: number) =>
  Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));

describe('rotate by any angle (T113)', () => {
  it('keeps bulges, vertex count and closedness', () => {
    fc.assert(
      fc.property(shape, angle, (p, a) => {
        const r = rotate(p, a);
        expect(r.closed).toBe(p.closed);
        expect(r.vertices.map((v) => v.bulge)).toEqual(p.vertices.map((v) => v.bulge));
      }),
    );
  });

  it('area, length and orientation are invariant', () => {
    fc.assert(
      fc.property(shape, angle, (p, a) => {
        const r = rotate(p, a);
        expect(rel(signedArea(r), signedArea(p))).toBe(true);
        expect(rel(length(r), length(p))).toBe(true);
        expect(orientation(r)).toBe(orientation(p));
      }),
    );
  });

  it('rotating by a then −a returns the shape (within float noise)', () => {
    fc.assert(
      fc.property(shape, angle, (p, a) => {
        const back = rotate(rotate(p, a), -a);
        back.vertices.forEach((v, i) => {
          const o = p.vertices[i];
          expect(Math.abs(v.x - (o?.x ?? 0))).toBeLessThan(1e-6);
          expect(Math.abs(v.y - (o?.y ?? 0))).toBeLessThan(1e-6);
        });
      }),
    );
  });

  it('quarter turns go through the exact path (byte-identical to rotatePoint)', () => {
    fc.assert(
      fc.property(finite(-1e4, 1e4), finite(-1e4, 1e4), (x, y) => {
        for (const q of [0, 90, 180, 270] as const) {
          expect(rotatePointBy({ x, y }, q)).toEqual(rotatePoint({ x, y }, q));
          expect(rotatePointBy({ x, y }, q + 360)).toEqual(rotatePoint({ x, y }, q));
        }
      }),
    );
    expect(isQuarterTurn(90)).toBe(true);
    expect(isQuarterTurn(30)).toBe(false);
    expect(transform(contour(rectOutline({ w: 10, h: 20, r: 0 })), { rotate: 90 })).toEqual(
      rotate(contour(rectOutline({ w: 10, h: 20, r: 0 })), 90),
    );
  });

  it('a rotated circle keeps its bbox size (arc-aware bbox of rotated outlines)', () => {
    fc.assert(
      fc.property(circle, angle, (c, a) => {
        const b0 = bbox(c);
        const b1 = bbox(rotate(c, a));
        expect(Math.abs(b1.maxX - b1.minX - (b0.maxX - b0.minX))).toBeLessThan(1e-6);
        expect(Math.abs(b1.maxY - b1.minY - (b0.maxY - b0.minY))).toBeLessThan(1e-6);
      }),
    );
  });

  it('the bbox of a rotated outline is tight: it holds every arc sample and touches all four sides', () => {
    fc.assert(
      fc.property(roundedRect, angle, (p, a) => {
        const r = rotate(p, a);
        const b = bbox(r);
        const pts: { x: number; y: number }[] = [];
        forEachSegment(r, (s, e, bulge) => pts.push(...sampleSegment(s, e, bulge, 64)));
        for (const q of pts) {
          expect(q.x).toBeGreaterThanOrEqual(b.minX - EPS);
          expect(q.x).toBeLessThanOrEqual(b.maxX + EPS);
          expect(q.y).toBeGreaterThanOrEqual(b.minY - EPS);
          expect(q.y).toBeLessThanOrEqual(b.maxY + EPS);
        }
        // Sampling at 64 steps per quarter arc is within ~0.03 % of the radius of the extreme.
        const tol = Math.max(1e-6, 1e-3 * Math.max(b.maxX - b.minX, b.maxY - b.minY));
        expect(Math.min(...pts.map((q) => q.x)) - b.minX).toBeLessThan(tol);
        expect(b.maxX - Math.max(...pts.map((q) => q.x))).toBeLessThan(tol);
        expect(Math.min(...pts.map((q) => q.y)) - b.minY).toBeLessThan(tol);
        expect(b.maxY - Math.max(...pts.map((q) => q.y))).toBeLessThan(tol);
      }),
    );
  });
});
