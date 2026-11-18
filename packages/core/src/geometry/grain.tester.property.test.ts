/**
 * Tester (B5, T112/T113): grain and rotation algebra (D-034, D-038), fast-check.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { rotationSchema } from '../schema';
import {
  allowedRotations,
  mirrorGrain,
  normalizeGrain,
  normalizeRotation,
  turnGrain,
} from './grain';
import { bbox, signedArea } from './polyline';
import { rotate, rotatePointBy, type QuarterTurn } from './transform';
import type { Polyline } from './types';

const grain3 = fc.integer({ min: 0, max: 179_999 }).map((n) => n / 1000);
const rot3 = fc.integer({ min: 0, max: 359_999 }).map((n) => n / 1000);
const anyDeg = fc.double({ min: -1e4, max: 1e4, noNaN: true });
const turn = fc.constantFrom<QuarterTurn>(0, 90, 180, 270);

/** Distance of two grain lines (undirected, mod 180). */
function grainDist(a: number, b: number): number {
  const d = Math.abs((((a - b) % 180) + 180) % 180);
  return Math.min(d, 180 - d);
}

const roundedRect: Polyline = {
  closed: true,
  vertices: [
    { x: 10, y: 0, bulge: 0 },
    { x: 290, y: 0, bulge: Math.tan(Math.PI / 8) },
    { x: 300, y: 10, bulge: 0 },
    { x: 300, y: 140, bulge: Math.tan(Math.PI / 8) },
    { x: 290, y: 150, bulge: 0 },
    { x: 10, y: 150, bulge: Math.tan(Math.PI / 8) },
    { x: 0, y: 140, bulge: 0 },
    { x: 0, y: 10, bulge: Math.tan(Math.PI / 8) },
  ],
};

describe('grain algebra (tester)', () => {
  it('normalizeGrain: range [0, 180), idempotent, period 180', () => {
    fc.assert(
      fc.property(anyDeg, fc.integer({ min: -20, max: 20 }), (a, k) => {
        const g = normalizeGrain(a);
        expect(g).toBeGreaterThanOrEqual(0);
        expect(g).toBeLessThan(180);
        expect(normalizeGrain(g)).toBe(g);
        expect(grainDist(normalizeGrain(a + 180 * k), g)).toBeLessThan(1e-6);
      }),
    );
  });

  it('normalizeRotation: range [0, 360), ≤ 3 decimals, idempotent, accepted by the schema', () => {
    fc.assert(
      fc.property(anyDeg, (a) => {
        const r = normalizeRotation(a);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThan(360);
        expect(normalizeRotation(r)).toBe(r);
        expect(rotationSchema.safeParse(r).success).toBe(true);
      }),
    );
  });

  it('rotation schema boundaries', () => {
    for (const ok of [0, 0.001, 30, 89.999, 179.999, 359.999]) {
      expect(rotationSchema.safeParse(ok).success).toBe(true);
    }
    for (const bad of [-0.001, 360, 30.0001, Number.NaN, Infinity]) {
      expect(rotationSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('turnGrain composes like rotations; 4 × 90 = identity; mirror twice = identity', () => {
    fc.assert(
      fc.property(grain3, turn, turn, (g, a, b) => {
        expect(grainDist(turnGrain(turnGrain(g, a), b), g + a + b)).toBeLessThan(1e-9);
        let x = g;
        for (let i = 0; i < 4; i++) x = turnGrain(x, 90);
        expect(x).toBe(g);
        expect(mirrorGrain(mirrorGrain(g))).toBe(g);
        // mirror ∘ turn(t) = turn(−t) ∘ mirror
        const t = ((360 - a) % 360) as QuarterTurn;
        expect(mirrorGrain(turnGrain(g, a))).toBe(turnGrain(mirrorGrain(g), t));
      }),
    );
  });

  it('allowedRotations (3-decimal angles): exactly two rotations 180 apart, grain on sheet grain', () => {
    fc.assert(
      fc.property(grain3, grain3, (sheet, part) => {
        const rots = allowedRotations({ grain: { mode: 'fixed', angle: part } }, { grain: sheet });
        expect(rots).toHaveLength(2);
        const [a, b] = rots as [number, number];
        expect(Math.abs(b - a - 180)).toBeLessThan(1e-9);
        for (const r of rots) {
          expect(rotationSchema.safeParse(r).success).toBe(true);
          expect(grainDist(part + r, sheet)).toBeLessThan(1e-9);
        }
      }),
    );
  });

  it('allowedRotations with unrounded sheet/part angles: grain error ≤ 0.0005° (3-decimal rot)', () => {
    const real = fc.double({ min: 0, max: 179.9999, noNaN: true });
    fc.assert(
      fc.property(real, real, (sheet, part) => {
        const rots = allowedRotations({ grain: { mode: 'fixed', angle: part } }, { grain: sheet });
        for (const r of rots) expect(grainDist(part + r, sheet)).toBeLessThanOrEqual(0.0005 + 1e-9);
      }),
    );
  });

  it('free part or sheet without grain → quarter turns, whatever the angles', () => {
    fc.assert(
      fc.property(grain3, fc.option(grain3, { nil: null }), (part, sheet) => {
        expect(
          allowedRotations({ grain: { mode: 'free', angle: part } }, { grain: sheet }),
        ).toEqual([0, 90, 180, 270]);
        expect(
          allowedRotations({ grain: { mode: 'fixed', angle: part } }, { grain: null }),
        ).toEqual([0, 90, 180, 270]);
      }),
    );
  });
});

describe('rotation composition (tester)', () => {
  it('rotate(rotate(p, a), b) ≈ rotate(p, a + b); area and bbox area bounds hold', () => {
    fc.assert(
      fc.property(rot3, rot3, (a, b) => {
        const two = rotate(rotate(roundedRect, a), b);
        const one = rotate(roundedRect, a + b);
        two.vertices.forEach((v, i) => {
          const w = one.vertices[i];
          expect(Math.hypot(v.x - (w?.x ?? NaN), v.y - (w?.y ?? NaN))).toBeLessThan(1e-9);
          expect(v.bulge).toBe(w?.bulge);
        });
        const area = signedArea(roundedRect);
        expect(Math.abs(signedArea(one) - area)).toBeLessThan(1e-7);
        const bb = bbox(one);
        // The rotated bbox is at least the part's area and at most its circumscribed square.
        const diag = Math.hypot(300, 150);
        expect((bb.maxX - bb.minX) * (bb.maxY - bb.minY)).toBeGreaterThanOrEqual(area - 1e-6);
        expect(bb.maxX - bb.minX).toBeLessThanOrEqual(diag + 1e-9);
        expect(bb.maxY - bb.minY).toBeLessThanOrEqual(diag + 1e-9);
      }),
      { numRuns: 200 },
    );
  });

  it('rotatePointBy: 360 + a ≡ a, −a ≡ 360 − a; near-quarter angles are continuous', () => {
    fc.assert(
      fc.property(rot3, fc.double({ min: -500, max: 500, noNaN: true }), (a, x) => {
        const p = { x, y: 37 };
        const q1 = rotatePointBy(p, a);
        const q2 = rotatePointBy(p, a + 360);
        const q3 = rotatePointBy(p, a - 360);
        expect(Math.hypot(q1.x - q2.x, q1.y - q2.y)).toBeLessThan(1e-9);
        expect(Math.hypot(q1.x - q3.x, q1.y - q3.y)).toBeLessThan(1e-9);
      }),
    );
    // 89.999 vs 90 (exact path) differ by ~|p|·1.75e-5 only: no jump at the switch to cos/sin.
    for (const q of [0, 90, 180, 270]) {
      const p = { x: 1000, y: 500 };
      const e = rotatePointBy(p, q);
      for (const d of [-0.001, 0.001]) {
        const n = rotatePointBy(p, q + d);
        expect(Math.hypot(n.x - e.x, n.y - e.y)).toBeLessThan(0.03);
      }
    }
  });
});
