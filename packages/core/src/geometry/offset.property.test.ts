/**
 * Property tests for `offset` (T007, geometry-kernel skill):
 * - every point of the offset path is |d| ± EPS from the original contour (sampled)
 * - direction preserved, closed stays closed
 * - consistent under translation and quarter turns
 * - same result (loop count, area) as the cavalier-contours-js port of CavalierContours, used here
 *   only as a test oracle (devDependency)
 */
import { plineClosed } from 'cavalier-contours-js';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { rectOutline } from '../schema/outline';
import { EPS } from './constants';
import { offset } from './offset';
import { maxDeviation } from './offset.testing';
import {
  bbox,
  contour,
  forEachSegment,
  length,
  orientation,
  reverse,
  signedArea,
} from './polyline';
import { arcOf } from './segment';
import { rotate, translate, type QuarterTurn } from './transform';
import type { Polyline } from './types';

const finite = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true }).map((v) => (v === 0 ? 0 : v));

const size = finite(1, 3000);
const shift = finite(-1000, 1000);

const rect = fc
  .record({ w: size, h: size, x: shift, y: shift })
  .map(({ w, h, x, y }) => translate(contour(rectOutline({ w, h, r: 0 })), x, y));

const roundedRect = fc
  .record({ w: size, h: size, k: finite(0, 1), x: shift, y: shift })
  .map(({ w, h, k, x, y }) =>
    translate(contour(rectOutline({ w, h, r: (k * Math.min(w, h)) / 2 })), x, y),
  );

/**
 * Star-shaped polygon: vertices at increasing angles (so it is simple), random radii 40–100 % of
 * R (so it has concave corners), some edges bulged. Large bulges can make it self-intersect; those
 * are filtered with `fc.pre` on the SELF_INTERSECTING rejection.
 */
const star = fc
  .record({
    weights: fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 3, maxLength: 14 }),
    radius: finite(5, 1500),
    cx: shift,
    cy: shift,
  })
  .chain(({ weights, radius, cx, cy }) =>
    fc
      .array(fc.tuple(finite(0.4, 1), fc.oneof(fc.constant(0), finite(-0.25, 0.35))), {
        minLength: weights.length,
        maxLength: weights.length,
      })
      .map((vs) => {
        const total = weights.reduce((a, b) => a + b, 0);
        let acc = 0;
        return contour(
          weights.map((w, i) => {
            const t = (2 * Math.PI * acc) / total;
            acc += w;
            const [k, bulge] = vs[i] ?? [1, 0];
            return { x: cx + radius * k * Math.cos(t), y: cy + radius * k * Math.sin(t), bulge };
          }),
        );
      }),
  );

/** Any test shape, either direction, and an offset distance relative to its size. */
const shapeAndD = fc
  .tuple(fc.oneof(rect, roundedRect, star), fc.boolean(), finite(-0.3, 0.3))
  .map(([p, flip, k]) => {
    const b = bbox(p);
    const d = k * Math.min(b.maxX - b.minX, b.maxY - b.minY);
    return { poly: flip ? reverse(p) : p, d };
  });

/** Below this offset (mm) the oracle itself is unreliable. */
const ORACLE_MIN_D = 0.01;
/** Arcs over 100 m radius: offset.ts flattens them and the oracle loses precision on them. */
function hasHugeArc(poly: Polyline): boolean {
  let huge = false;
  forEachSegment(poly, (a, b, bulge) => {
    huge ||= (arcOf(a, b, bulge)?.radius ?? 0) > 1e5;
  });
  return huge;
}

/** OFFSET_RUNS=20000 pnpm test for a long local run. */
// core has no Node types (purity); read the env var defensively
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env;
const RUNS = Number(env?.OFFSET_RUNS ?? 1);
const TIMEOUT = 10_000 * RUNS;

const areaOf = (ps: readonly Polyline[]) => ps.reduce((s, p) => s + signedArea(p), 0);

/** Oracle: cavalier-contours-js (positive offset = left of travel, so pass −d). */
function cavalierOffset(poly: Polyline, d: number): Polyline[] | undefined {
  try {
    return plineClosed(poly.vertices.map((v) => [v.x, v.y, v.bulge] as const))
      .parallelOffset(-d)
      .map((o) => ({
        closed: true,
        vertices: o.vertexData.map((q) => ({ x: q.x, y: q.y, bulge: q.bulge })),
      }));
  } catch {
    return undefined;
  }
}

describe('offset: properties', () => {
  it(
    'every point of the result is |d| ± EPS from the original; closed; direction kept',
    () => {
      fc.assert(
        fc.property(shapeAndD, ({ poly, d }) => {
          const r = offset(poly, d);
          fc.pre(r.ok || r.reason !== 'SELF_INTERSECTING');
          if (!r.ok) {
            expect(r.reason).toBe('COLLAPSED');
            // only a shrinking offset may vanish: left of a CCW contour, right of a CW one
            expect(orientation(poly) === 'ccw' ? d < 0 : d > 0).toBe(true);
            return;
          }
          const dir = orientation(poly);
          for (const p of r.polylines) {
            expect(p.closed).toBe(true);
            expect(orientation(p)).toBe(dir);
          }
          expect(maxDeviation(r.polylines, poly, d)).toBeLessThan(EPS);
        }),
        { numRuns: 300 * RUNS },
      );
    },
    TIMEOUT,
  );

  it(
    'a growing offset never fails and yields one loop with a larger |area|',
    () => {
      fc.assert(
        fc.property(shapeAndD, ({ poly, d }) => {
          const grow = orientation(poly) === 'ccw' ? Math.abs(d) : -Math.abs(d);
          fc.pre(Math.abs(grow) >= EPS);
          const r = offset(poly, grow);
          fc.pre(r.ok || r.reason !== 'SELF_INTERSECTING');
          expect(r.ok).toBe(true);
          if (!r.ok) return;
          expect(r.polylines).toHaveLength(1);
          expect(Math.abs(areaOf(r.polylines))).toBeGreaterThan(Math.abs(signedArea(poly)));
        }),
        { numRuns: 200 * RUNS },
      );
    },
    TIMEOUT,
  );

  it(
    'commutes with translation and quarter turns (area and loop count)',
    () => {
      fc.assert(
        fc.property(
          shapeAndD,
          shift,
          shift,
          fc.constantFrom<QuarterTurn>(90, 180, 270),
          ({ poly, d }, dx, dy, deg) => {
            const base = offset(poly, d);
            fc.pre(base.ok);
            if (!base.ok) return;
            const moved = offset(rotate(translate(poly, dx, dy), deg), d);
            expect(moved.ok).toBe(true);
            if (!moved.ok) return;
            expect(moved.polylines).toHaveLength(base.polylines.length);
            const a = areaOf(base.polylines);
            expect(Math.abs(areaOf(moved.polylines) - a)).toBeLessThan(
              Math.max(1e-6, 1e-9 * Math.abs(a)),
            );
          },
        ),
        { numRuns: 150 * RUNS },
      );
    },
    TIMEOUT,
  );

  it(
    'matches the CavalierContours port (loop count and area)',
    () => {
      fc.assert(
        fc.property(shapeAndD, ({ poly, d }) => {
          // cavalier: arcs ≤ 180° and positive offset = left of travel
          // the port returns wrong results for sub-0.01 mm features (see docs/spikes/T007-offset.md),
          // so the comparison only runs on well-conditioned input
          fc.pre(poly.vertices.every((v) => Math.abs(v.bulge) <= 1) && Math.abs(d) >= ORACLE_MIN_D);
          fc.pre(!hasHugeArc(poly));
          const r = offset(poly, d);
          fc.pre(r.ok || r.reason !== 'SELF_INTERSECTING');
          let oracle = cavalierOffset(poly, d);
          fc.pre(oracle !== undefined); // the port has thrown a debug assertion on rare inputs
          if (!oracle) return;
          const mine = r.ok ? r.polylines : [];
          // offset.ts drops slivers with |area| ≤ EPS² (not a cuttable path); compare the same way
          oracle = oracle.filter((o) => Math.abs(signedArea(o)) > EPS * EPS);
          expect(mine.length).toBe(oracle.length);
          const a = areaOf(oracle);
          // relative 1e-6, or a 1e-5 mm strip along the path (near-collapse slivers, node snapping)
          const perimeter = oracle.reduce((s, o) => s + length(o), 0);
          expect(Math.abs(areaOf(mine) - a)).toBeLessThan(
            Math.max(1e-6 * Math.abs(a), 1e-5 * perimeter, 1e-9),
          );
        }),
        { numRuns: 300 * RUNS },
      );
    },
    TIMEOUT,
  );
});
