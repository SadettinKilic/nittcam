/**
 * T306: true-shape positions carry no nudge / bisection residue (e.g. 522.0001 reached the Mach3
 * output as X522.0001): the tidy pass puts them on the 0.001 mm grid. It never changes sheet
 * counts, order or rotations, moves a position by less than 0.001 mm and never makes an overlap.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Polyline } from '../geometry/types';
import { footprintContours, footprintsOverlap, moveFootprint, shapeOption } from './shape';
import { packTrueShape, tidyCandidates, type ShapeItem } from './trueshape';

const v = (x: number, y: number, bulge = 0) => ({ x, y, bulge });
const poly = (...vs: ReturnType<typeof v>[]): Polyline => ({ closed: true, vertices: vs });
const SHAPES: Polyline[] = [
  poly(v(0, 0), v(120, 0), v(120, 120), v(0, 120)),
  poly(v(0, 0), v(150, 0), v(0, 150)),
  poly(v(0, 45, 1), v(90, 45, 1)),
  poly(v(0, 0), v(140, 0), v(140, 46), v(46, 46), v(46, 140), v(0, 140)),
  poly(v(0, 0), v(200, 0), v(200, 60), v(0, 60)),
];

/** Off the grid by this much (mm); 0 = on it. */
const gridOff = (n: number) => Math.abs(n * 1000 - Math.round(n * 1000)) / 1000;

function items(
  parts: { shape: number; scale: number; qty: number; rots: readonly number[] }[],
  spacing: number,
): ShapeItem[] {
  return parts.flatMap((p, i) => {
    const base = SHAPES[p.shape] as Polyline;
    const outline: Polyline = {
      closed: true,
      vertices: base.vertices.map((q) => ({ x: q.x * p.scale, y: q.y * p.scale, bulge: q.bulge })),
    };
    const fc0 = footprintContours(outline, [], spacing);
    const options = p.rots.map((r) => shapeOption(outline, fc0, r));
    const area = (options[0]?.w ?? 0) * (options[0]?.h ?? 0) * 0.5;
    return Array.from({ length: p.qty }, (_, k) => ({ partId: `p${i}`, index: k, options, area }));
  });
}

describe('T306 tidyCandidates', () => {
  it('the nearest grid value first, then the other side; nothing for a value on the grid', () => {
    expect(tidyCandidates(522.0001)).toEqual([522, 522.001]);
    expect(tidyCandidates(117.9999)).toEqual([118, 117.999]);
    expect(tidyCandidates(12.0002)).toEqual([12, 12.001]);
    expect(tidyCandidates(0.0001)).toEqual([0, 0.001]);
    expect(tidyCandidates(598.0284)).toEqual([598.028, 598.029]);
    expect(tidyCandidates(1143.6749)).toEqual([1143.675, 1143.674]);
    expect(tidyCandidates(12)).toEqual([]);
    expect(tidyCandidates(12.5)).toEqual([]);
    expect(tidyCandidates(0.1 + 0.2)).toEqual([]); // float noise on a grid value
  });
});

const partArb = fc.record({
  shape: fc.integer({ min: 0, max: SHAPES.length - 1 }),
  scale: fc.double({ min: 0.4, max: 1.5, noNaN: true }),
  qty: fc.integer({ min: 1, max: 4 }),
  rots: fc.constantFrom([0], [0, 180], [0, 90, 180, 270], [30, 210], [0, 45, 90, 135]),
});

describe('T306 tidy pass (fast-check)', () => {
  it('no residue; same sheets, order and rotations; moves < 0.001 mm; never an overlap', () => {
    fc.assert(
      fc.property(
        fc.array(partArb, { minLength: 1, maxLength: 5 }),
        fc.integer({ min: 0, max: 15 }),
        fc.double({ min: 0, max: 6, noNaN: true }),
        (parts, margin, spacing) => {
          const list = items(parts, spacing);
          const input = { dims: [{ width: 800, height: 500 }], margin, locked: [] };
          const raw = packTrueShape(input, list, { tidy: false });
          const tidy = packTrueShape(input, list);
          expect(packTrueShape(input, list)).toEqual(tidy); // deterministic
          expect(tidy.sizeOf).toEqual(raw.sizeOf);
          expect(tidy.unplaced).toEqual(raw.unplaced);
          tidy.sheets.forEach((sheet, si) => {
            const before = raw.sheets[si] ?? [];
            expect(sheet.map((p) => [p.partId, p.index, p.rot])).toEqual(
              before.map((p) => [p.partId, p.index, p.rot]),
            );
            const fps = sheet.map((p, k) => {
              const o = before[k] as (typeof before)[number];
              expect(Math.abs(p.x - o.x)).toBeLessThan(0.001 + 1e-9);
              expect(Math.abs(p.y - o.y)).toBeLessThan(0.001 + 1e-9);
              // On the grid, or (when no grid value next to it is free) exactly where it was.
              if (gridOff(p.x) > 1e-9) expect(p.x).toBe(o.x);
              if (gridOff(p.y) > 1e-9) expect(p.y).toBe(o.y);
              if (tidyCandidates(o.x).length === 0) expect(p.x).toBe(o.x);
              if (tidyCandidates(o.y).length === 0) expect(p.y).toBe(o.y);
              const item = list.find((it) => it.partId === p.partId && it.index === p.index);
              const opt = item?.options.find((op) => op.rot === p.rot);
              if (!opt) throw new Error('no option');
              expect(p.x).toBeGreaterThanOrEqual(margin - 1e-6);
              expect(p.y).toBeGreaterThanOrEqual(margin - 1e-6);
              expect(p.x + opt.w).toBeLessThanOrEqual(800 - margin + 1e-6);
              expect(p.y + opt.h).toBeLessThanOrEqual(500 - margin + 1e-6);
              return moveFootprint(opt.fp, p.x, p.y);
            });
            for (let i = 0; i < fps.length; i++)
              for (let j = i + 1; j < fps.length; j++)
                expect(footprintsOverlap(fps[i] as never, fps[j] as never)).toBe(false);
          });
        },
      ),
      { numRuns: 30 },
    );
  });

  it('the nudge next to a neighbour leaves no 0.0001 in the position', () => {
    const list = items([{ shape: 0, scale: 1, qty: 6, rots: [0] }], 3);
    const res = packTrueShape(
      { dims: [{ width: 800, height: 500 }], margin: 10, locked: [] },
      list,
    );
    const coords = res.sheets.flat().flatMap((p) => [p.x, p.y]);
    expect(coords.length).toBe(12);
    for (const c of coords) expect(gridOff(c)).toBeLessThan(1e-9);
    const raw = packTrueShape(
      { dims: [{ width: 800, height: 500 }], margin: 10, locked: [] },
      list,
      { tidy: false },
    );
    // The untidied placer does leave the residue (what this task removes).
    expect(raw.sheets.flat().some((p) => gridOff(p.x) > 1e-9 || gridOff(p.y) > 1e-9)).toBe(true);
  });
});
