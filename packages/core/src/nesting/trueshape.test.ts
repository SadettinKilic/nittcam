import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EPS } from '../geometry/constants';
import { bbox, normalize } from '../geometry/polyline';
import { sampleSegment } from '../geometry/segment';
import { rotate, translate } from '../geometry/transform';
import type { Point, Polyline } from '../geometry/types';
import { nest } from './nest';
import {
  discretise,
  footprintContours,
  footprintsOverlap,
  moveFootprint,
  pointOccupied,
  shapeOption,
} from './shape';
import type { NestingInput, NestPart } from './types';

const v = (x: number, y: number, bulge = 0) => ({ x, y, bulge });
const poly = (...vs: ReturnType<typeof v>[]): Polyline => ({ closed: true, vertices: vs });
const square = (s: number) => poly(v(0, 0), v(s, 0), v(s, s), v(0, s));
const triangle = (s: number) => poly(v(0, 0), v(s, 0), v(0, s));
const circle = (d: number) => poly(v(0, d / 2, 1), v(d, d / 2, 1));
const ell = (s: number) =>
  poly(v(0, 0), v(s, 0), v(s, s / 3), v(s / 3, s / 3), v(s / 3, s), v(0, s));

function fpAt(outline: Polyline, s: number, rot: number, x: number, y: number) {
  return moveFootprint(shapeOption(outline, footprintContours(outline, [], s), rot).fp, x, y);
}

describe('footprints (T165)', () => {
  it('touching footprints do not overlap; any intrusion does', () => {
    const a = fpAt(square(100), 5, 0, 0, 0); // footprint −5…105
    expect(footprintsOverlap(a, fpAt(square(100), 5, 0, 110, 0))).toBe(false);
    expect(footprintsOverlap(a, fpAt(square(100), 5, 0, 109.5, 0))).toBe(true);
    expect(footprintsOverlap(a, fpAt(square(100), 5, 0, 0, 0))).toBe(true);
    expect(footprintsOverlap(a, fpAt(square(100), 5, 0, 50, 0))).toBe(true);
    // Fully inside (no edge crossings) is caught by the probes.
    expect(footprintsOverlap(fpAt(square(300), 5, 0, 0, 0), fpAt(square(20), 5, 0, 100, 100))).toBe(
      true,
    );
  });

  it('diagonal neighbours need only the Euclidean clearance (round tool)', () => {
    const a = fpAt(square(100), 5, 0, 0, 0);
    // Corner to corner 10/√2 apart on each axis ≈ 10 mm apart: allowed (rounded corners).
    expect(footprintsOverlap(a, fpAt(square(100), 5, 0, 107.1, 107.1))).toBe(false);
    expect(footprintsOverlap(a, fpAt(square(100), 5, 0, 106, 106))).toBe(true);
  });

  it('a footprint in a hole zone does not overlap the host', () => {
    const outer = square(300);
    const hole = poly(v(50, 50), v(50, 250), v(250, 250), v(250, 50)); // CW
    const host = shapeOption(outer, footprintContours(outer, [hole], 5), 0).fp;
    expect(footprintsOverlap(host, fpAt(square(100), 5, 0, 100, 100))).toBe(false);
    expect(footprintsOverlap(host, fpAt(square(100), 5, 0, 55, 100))).toBe(true);
  });

  it('discretised arcs cover the true arc (safe side)', () => {
    const fc = footprintContours(circle(100), [], 0);
    const fp = shapeOption(circle(100), fc, 0).fp;
    for (let k = 0; k < 360; k += 7) {
      const t = (k * Math.PI) / 180;
      expect(pointOccupied(fp, 50 + 49.99 * Math.cos(t), 50 + 49.99 * Math.sin(t))).toBe(true);
    }
    expect(discretise(circle(100)).length).toBeGreaterThan(8);
  });
});

// ---- Independent re-check (a different algorithm): dense outline samples, point-segment
// distances and point-in-polygon on the samples; no offsets, no footprints.

function placedSamples(outline: Polyline, rot: number, x: number, y: number): Point[] {
  const turned = rotate(normalize(outline, 'outer'), rot);
  const b = bbox(turned);
  const moved = translate(turned, x - b.minX, y - b.minY);
  const out: Point[] = [];
  const vs = moved.vertices;
  vs.forEach((a, i) => {
    const n = vs[(i + 1) % vs.length] as typeof a;
    const pts = sampleSegment(a, n, a.bulge, 64);
    out.push(...pts.slice(0, -1));
  });
  return out;
}

function segDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = dx * dx + dy * dy;
  const t = l === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

function inside(p: Point, ring: readonly Point[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as Point;
    const b = ring[j] as Point;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

function ringDistance(a: readonly Point[], b: readonly Point[]): number {
  if (inside(a[0] as Point, b) || inside(b[0] as Point, a)) return -1;
  let d = Infinity;
  for (const p of a)
    for (let j = 0; j < b.length; j++)
      d = Math.min(d, segDist(p, b[j] as Point, b[(j + 1) % b.length] as Point));
  for (const p of b)
    for (let j = 0; j < a.length; j++)
      d = Math.min(d, segDist(p, a[j] as Point, a[(j + 1) % a.length] as Point));
  return d;
}

const SHAPES = [
  square(120),
  triangle(150),
  circle(90),
  ell(140),
  poly(v(0, 0), v(200, 0), v(200, 60), v(0, 60)),
];

const partArb = fc.record({
  shape: fc.integer({ min: 0, max: SHAPES.length - 1 }),
  scale: fc.double({ min: 0.4, max: 1.5, noNaN: true }),
  qty: fc.integer({ min: 1, max: 4 }),
  rotations: fc.constantFrom(
    [0],
    [0, 180],
    [0, 90, 180, 270],
    [0, 45, 90, 135, 180, 225, 270, 315],
    [30, 210],
  ),
});

function toInput(
  parts: { shape: number; scale: number; qty: number; rotations: readonly number[] }[],
  gap: number,
  margin: number,
): NestingInput {
  const nestParts: NestPart[] = parts.map((p, i) => {
    const base = SHAPES[p.shape] as Polyline;
    const outline: Polyline = {
      closed: true,
      vertices: base.vertices.map((q) => ({ x: q.x * p.scale, y: q.y * p.scale, bulge: q.bulge })),
    };
    const b = bbox(outline);
    return {
      id: `p${i}`,
      w: b.maxX - b.minX,
      h: b.maxY - b.minY,
      qty: p.qty,
      rotations: p.rotations,
      outline,
    };
  });
  return {
    sheet: { width: 800, height: 500 },
    parts: nestParts,
    gap,
    margin,
    toolDiameter: 6,
    mode: 'minWaste',
    locked: [],
    engine: 'trueShape',
  };
}

describe('true-shape placer invariants (T165, fast-check)', () => {
  it('no two outlines closer than tool + gap, inside the sheet minus margin, deterministic', () => {
    fc.assert(
      fc.property(
        fc.array(partArb, { minLength: 1, maxLength: 5 }),
        fc.double({ min: 0, max: 6, noNaN: true }),
        fc.double({ min: 0, max: 15, noNaN: true }),
        (parts, gap, margin) => {
          const input = toInput(parts, gap, margin);
          const res = nest(input);
          expect(nest(input)).toEqual(res);
          const required = input.toolDiameter + gap;
          const byId = new Map(input.parts.map((p) => [p.id, p]));
          let placed = 0;
          res.layout.sheets.forEach((sh) => {
            const rings = sh.placements.map((pl) => {
              const part = byId.get(pl.partId) as NestPart;
              expect(part.rotations).toContain(pl.rot);
              const pts = placedSamples(part.outline as Polyline, pl.rot, pl.x, pl.y);
              for (const p of pts) {
                expect(p.x).toBeGreaterThanOrEqual(margin - 0.01);
                expect(p.y).toBeGreaterThanOrEqual(margin - 0.01);
                expect(p.x).toBeLessThanOrEqual(800 - margin + 0.01);
                expect(p.y).toBeLessThanOrEqual(500 - margin + 0.01);
              }
              return pts;
            });
            placed += rings.length;
            for (let i = 0; i < rings.length; i++)
              for (let j = i + 1; j < rings.length; j++)
                expect(
                  ringDistance(rings[i] as Point[], rings[j] as Point[]),
                ).toBeGreaterThanOrEqual(required - 0.01);
          });
          const copies = input.parts.reduce((s, p) => s + p.qty, 0);
          expect(placed + res.unplaced.length).toBe(copies);
          expect(res.utilisationPercent).toBeLessThanOrEqual(100 + EPS);
        },
      ),
      { numRuns: 25 },
    );
  });
});

describe('true-shape placer (T165)', () => {
  it('interlocks triangles: fewer sheets than the rectangle placer', () => {
    const t = triangle(300);
    const input: NestingInput = {
      sheet: { width: 1000, height: 700 },
      parts: [{ id: 't', w: 300, h: 300, qty: 12, rotations: [0, 180], outline: t }],
      gap: 4,
      margin: 10,
      toolDiameter: 6,
      mode: 'minWaste',
      locked: [],
    };
    const rect = nest(input);
    const shape = nest({ ...input, engine: 'trueShape' });
    expect(shape.unplaced).toEqual([]);
    expect(shape.sheetCount).toBeLessThan(rect.sheetCount);
    expect(shape.strategy.heuristic).toBe('trueshape-bl');
    expect(shape.info).toEqual([]);
  });

  it('keeps locked placements and avoids them', () => {
    const input: NestingInput = {
      sheet: { width: 600, height: 400 },
      parts: [{ id: 'a', w: 100, h: 100, qty: 3, outline: square(100) }],
      gap: 0,
      margin: 0,
      toolDiameter: 6,
      mode: 'minWaste',
      locked: [[{ partId: 'a', index: 0, x: 0, y: 0, rot: 0, locked: true }]],
      engine: 'trueShape',
    };
    const res = nest(input);
    const pls = res.layout.sheets[0]?.placements ?? [];
    expect(pls[0]).toEqual({ partId: 'a', index: 0, x: 0, y: 0, rot: 0, locked: true });
    for (const pl of pls.slice(1)) expect(Math.max(pl.x, pl.y)).toBeGreaterThanOrEqual(106 - 1e-6);
  });

  it('reports a part larger than every sheet as TOO_LARGE', () => {
    const res = nest({
      sheet: { width: 100, height: 100 },
      parts: [
        {
          id: 'big',
          w: 200,
          h: 50,
          qty: 1,
          rotations: [0],
          outline: poly(v(0, 0), v(200, 0), v(200, 50), v(0, 50)),
        },
      ],
      gap: 0,
      margin: 0,
      toolDiameter: 6,
      mode: 'minWaste',
      locked: [],
      engine: 'trueShape',
    });
    expect(res.unplaced).toEqual([{ partId: 'big', index: 0, reason: 'TOO_LARGE' }]);
  });
});
