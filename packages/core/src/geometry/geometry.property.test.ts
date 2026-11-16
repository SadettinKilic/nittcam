/**
 * Property tests for the bulge polyline kernel (T006). Shapes are simple (non-self-intersecting):
 * rectangles, rounded rectangles and convex polygons with small bulges.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { rectOutline } from '../schema/outline';
import { EPS } from './constants';
import {
  bbox,
  contour,
  forEachSegment,
  length,
  normalize,
  orientation,
  reverse,
  signedArea,
} from './polyline';
import { sampleSegment } from './segment';
import { mirror, rotate, transform, translate, type QuarterTurn } from './transform';
import type { Polyline } from './types';

const finite = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true }).map((v) => (v === 0 ? 0 : v)); // no −0

const size = finite(1, 5000);
const offset = finite(-1000, 1000);
const turn = fc.constantFrom<QuarterTurn>(0, 90, 180, 270);

/** Axis-aligned rectangle, CCW, at a random offset. */
const rect = fc
  .record({ w: size, h: size, x: offset, y: offset })
  .map(({ w, h, x, y }) => translate(contour(rectOutline({ w, h, r: 0 })), x, y));

/** Rounded rectangle (quarter arcs), CCW, at a random offset. */
const roundedRect = fc
  .record({ w: size, h: size, k: finite(0, 1), x: offset, y: offset })
  .map(({ w, h, k, x, y }) =>
    translate(contour(rectOutline({ w, h, r: (k * Math.min(w, h)) / 2 })), x, y),
  );

/**
 * Convex polygon inscribed in a circle (vertices at increasing angles, so CCW and star-free) with
 * random bulges. Each angle step is 1–3 weight units, so the smallest interior angle is 36°;
 * outward bulges ≤ 0.4 (87° arcs), inward bulges ≥ −0.15 (each arc tilts ≤ 17° at a vertex), so
 * two inward arcs can never cross at a corner.
 */
const bulgyConvex = fc
  .record({
    weights: fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 3, maxLength: 12 }),
    radius: finite(1, 2000),
    cx: offset,
    cy: offset,
    phase: finite(0, 2 * Math.PI),
  })
  .chain(({ weights, radius, cx, cy, phase }) =>
    fc
      .array(finite(-0.15, 0.4), { minLength: weights.length, maxLength: weights.length })
      .map((bulges) => {
        const total = weights.reduce((a, b) => a + b, 0);
        let acc = 0;
        return contour(
          weights.map((w, i) => {
            const t = phase + (2 * Math.PI * acc) / total;
            acc += w;
            return {
              x: cx + radius * Math.cos(t),
              y: cy + radius * Math.sin(t),
              bulge: bulges[i] ?? 0,
            };
          }),
        );
      }),
  );

/** Any test shape, in either direction. */
const shape = fc
  .tuple(fc.oneof(rect, roundedRect, bulgyConvex), fc.boolean())
  .map(([p, flip]) => (flip ? reverse(p) : p));

/** Tolerance that scales with the size of the numbers involved (float rounding), at least EPS. */
const tol = (...magnitudes: number[]) =>
  Math.max(EPS, 1e-12 * Math.max(...magnitudes.map(Math.abs)));

const extent = (p: Polyline) => {
  const b = bbox(p);
  return Math.max(Math.abs(b.minX), Math.abs(b.maxX), Math.abs(b.minY), Math.abs(b.maxY));
};

describe('signed area', () => {
  it('is invariant under translation', () => {
    fc.assert(
      fc.property(shape, offset, offset, (p, dx, dy) => {
        const a = signedArea(p);
        expect(Math.abs(signedArea(translate(p, dx, dy)) - a)).toBeLessThan(
          tol(a, (extent(p) + 1000) ** 2),
        );
      }),
    );
  });

  it('is invariant under 90° rotations', () => {
    fc.assert(
      fc.property(shape, turn, (p, deg) => {
        const a = signedArea(p);
        expect(Math.abs(signedArea(rotate(p, deg)) - a)).toBeLessThan(tol(a, extent(p) ** 2));
      }),
    );
  });

  it('is negated by mirroring (either axis) and by reversing', () => {
    fc.assert(
      fc.property(shape, fc.constantFrom('x' as const, 'y' as const), (p, axis) => {
        const a = signedArea(p);
        expect(Math.abs(signedArea(mirror(p, axis)) + a)).toBeLessThan(tol(a, extent(p) ** 2));
        expect(Math.abs(signedArea(reverse(p)) + a)).toBeLessThan(tol(a, extent(p) ** 2));
      }),
    );
  });

  it('a circle of two 180° arcs (bulge 1) has area πr² and length 2πr', () => {
    fc.assert(
      fc.property(finite(0.01, 5000), offset, offset, (r, cx, cy) => {
        const c = contour([
          { x: cx - r, y: cy, bulge: 1 },
          { x: cx + r, y: cy, bulge: 1 },
        ]);
        expect(Math.abs(signedArea(c) - Math.PI * r * r)).toBeLessThan(tol(r * r, (r + 1000) ** 2));
        expect(Math.abs(length(c) - 2 * Math.PI * r)).toBeLessThan(EPS);
      }),
    );
  });

  it('rectOutline with r > 0 has area wh − (4 − π)r²', () => {
    fc.assert(
      fc.property(size, size, finite(0, 1), (w, h, k) => {
        const r = (k * Math.min(w, h)) / 2;
        fc.pre(r >= EPS);
        const expected = w * h - (4 - Math.PI) * r * r;
        expect(Math.abs(signedArea(contour(rectOutline({ w, h, r }))) - expected)).toBeLessThan(
          tol(w * h),
        );
      }),
    );
  });
});

describe('bbox', () => {
  it('contains every sampled point of every segment (16 samples per arc) ± EPS', () => {
    fc.assert(
      fc.property(shape, (p) => {
        const box = bbox(p);
        forEachSegment(p, (a, b, bulge) => {
          for (const q of sampleSegment(a, b, bulge, 16)) {
            expect(q.x).toBeGreaterThanOrEqual(box.minX - EPS);
            expect(q.x).toBeLessThanOrEqual(box.maxX + EPS);
            expect(q.y).toBeGreaterThanOrEqual(box.minY - EPS);
            expect(q.y).toBeLessThanOrEqual(box.maxY + EPS);
          }
        });
      }),
    );
  });

  it('of a rounded rectangle is exactly w × h (arcs touch the sides)', () => {
    fc.assert(
      fc.property(size, size, finite(0, 1), (w, h, k) => {
        const box = bbox(contour(rectOutline({ w, h, r: (k * Math.min(w, h)) / 2 })));
        expect(Math.abs(box.minX)).toBeLessThan(EPS);
        expect(Math.abs(box.minY)).toBeLessThan(EPS);
        expect(Math.abs(box.maxX - w)).toBeLessThan(EPS);
        expect(Math.abs(box.maxY - h)).toBeLessThan(EPS);
      }),
    );
  });

  it('moves with translation and keeps its size under 90° rotations', () => {
    fc.assert(
      fc.property(shape, offset, offset, turn, (p, dx, dy, deg) => {
        const b = bbox(p);
        const t = bbox(translate(p, dx, dy));
        expect(Math.abs(t.minX - b.minX - dx)).toBeLessThan(EPS);
        expect(Math.abs(t.maxY - b.maxY - dy)).toBeLessThan(EPS);
        const r = bbox(rotate(p, deg));
        const [w, h] = [b.maxX - b.minX, b.maxY - b.minY];
        const [rw, rh] = [r.maxX - r.minX, r.maxY - r.minY];
        const turned = deg === 90 || deg === 270;
        expect(Math.abs(rw - (turned ? h : w))).toBeLessThan(EPS);
        expect(Math.abs(rh - (turned ? w : h))).toBeLessThan(EPS);
      }),
    );
  });
});

describe('orientation / normalize / reverse', () => {
  it('normalize gives the expected sign and is stable', () => {
    fc.assert(
      fc.property(shape, (p) => {
        const outer = normalize(p, 'outer');
        const inner = normalize(p, 'inner');
        expect(signedArea(outer)).toBeGreaterThan(0);
        expect(signedArea(inner)).toBeLessThan(0);
        expect(orientation(outer)).toBe('ccw');
        expect(orientation(inner)).toBe('cw');
        expect(normalize(outer, 'outer')).toEqual(outer);
        expect(normalize(inner, 'inner')).toEqual(inner);
        expect(normalize(normalize(p, 'inner'), 'outer')).toEqual(outer);
      }),
    );
  });

  it('reversing twice is the identity (closed and open)', () => {
    fc.assert(
      fc.property(shape, fc.boolean(), (p, open) => {
        const q: Polyline = open ? { ...p, closed: false } : p;
        expect(reverse(reverse(q))).toEqual(q);
      }),
    );
  });

  it('reversing keeps length and bbox', () => {
    fc.assert(
      fc.property(shape, (p) => {
        const r = reverse(p);
        expect(Math.abs(length(r) - length(p))).toBeLessThan(EPS);
        const [a, b] = [bbox(p), bbox(r)];
        expect(Math.abs(a.minX - b.minX) + Math.abs(a.maxX - b.maxX)).toBeLessThan(EPS);
        expect(Math.abs(a.minY - b.minY) + Math.abs(a.maxY - b.maxY)).toBeLessThan(EPS);
      }),
    );
  });
});

describe('length', () => {
  it('is invariant under translate, rotate and mirror', () => {
    fc.assert(
      fc.property(
        shape,
        fc.option(fc.constantFrom('x' as const, 'y' as const), { nil: undefined }),
        turn,
        offset,
        offset,
        (p, axis, deg, dx, dy) => {
          const moved = transform(p, { ...(axis ? { mirror: axis } : {}), rotate: deg, dx, dy });
          expect(Math.abs(length(moved) - length(p))).toBeLessThan(EPS);
        },
      ),
    );
  });
});
