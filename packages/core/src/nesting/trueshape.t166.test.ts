import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { allowedRotations, rotationPolicyOf } from '../geometry/grain';
import { bbox, normalize } from '../geometry/polyline';
import { rotate, translate } from '../geometry/transform';
import type { Polyline } from '../geometry/types';
import { partInHoleHosts } from '../toolpath/enclose';
import { cutOrder, type OrderItem } from '../toolpath/order';
import { nest } from './nest';
import type { NestingInput } from './types';

const v = (x: number, y: number, bulge = 0) => ({ x, y, bulge });
const poly = (...vs: ReturnType<typeof v>[]): Polyline => ({ closed: true, vertices: vs });
const rectPoly = (w: number, h: number, x = 0, y = 0) =>
  poly(v(x, y), v(x + w, y), v(x + w, y + h), v(x, y + h));

describe('rotation step policy (T166)', () => {
  it('free parts take 45° / 15° steps; none and free unchanged', () => {
    expect(rotationPolicyOf({ rotation: 'step45' }).freeRotations).toEqual([
      0, 45, 90, 135, 180, 225, 270, 315,
    ]);
    expect(rotationPolicyOf({ rotation: 'step15' }).freeRotations).toHaveLength(24);
    expect(rotationPolicyOf({ rotation: 'free' })).toEqual({});
    expect(rotationPolicyOf({ rotation: 'none' })).toEqual({ freeRotations: [0, 180] });
  });

  it('a fixed-grain part ignores the step policy (grain rule wins)', () => {
    const fixed = { grain: { mode: 'fixed' as const, angle: 10 } };
    expect(
      allowedRotations(fixed, { grain: 40 }, rotationPolicyOf({ rotation: 'step15' })),
    ).toEqual([30, 210]);
  });
});

describe('grain rule on the true-shape engine (T166, fast-check)', () => {
  it('fixed parts only at grain-aligned angles; free parts on the step grid', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 179 }),
        fc.integer({ min: 0, max: 179 }),
        fc.constantFrom('free' as const, 'step45' as const, 'step15' as const),
        fc.integer({ min: 1, max: 4 }),
        (sheetGrain, partGrain, rotation, qty) => {
          const policy = rotationPolicyOf({ rotation });
          const fixedRots = allowedRotations(
            { grain: { mode: 'fixed', angle: partGrain } },
            { grain: sheetGrain },
            policy,
          );
          const freeRots = allowedRotations(
            { grain: { mode: 'free', angle: 0 } },
            { grain: sheetGrain },
            policy,
          );
          const input: NestingInput = {
            sheet: { width: 900, height: 600 },
            parts: [
              { id: 'f', w: 160, h: 70, qty, rotations: fixedRots, outline: rectPoly(160, 70) },
              {
                id: 'g',
                w: 120,
                h: 90,
                qty,
                rotations: freeRots,
                outline: poly(v(0, 0), v(120, 0), v(0, 90)),
              },
            ],
            gap: 2,
            margin: 5,
            toolDiameter: 6,
            mode: 'minWaste',
            locked: [],
            engine: 'trueShape',
          };
          for (const sh of nest(input).layout.sheets) {
            for (const pl of sh.placements) {
              if (pl.partId === 'f') {
                expect(fixedRots).toContain(pl.rot);
                const d = (((partGrain + pl.rot - sheetGrain) % 180) + 180) % 180;
                expect(Math.min(d, 180 - d)).toBeLessThan(1e-3);
              } else {
                expect(freeRots).toContain(pl.rot);
              }
            }
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});

describe('part-in-hole (T166)', () => {
  // A 400 × 400 frame with a 300 × 300 cutout, and small 80 × 80 parts.
  const frame = rectPoly(400, 400);
  const hole = rectPoly(300, 300, 50, 50);
  const input = (partInHole: boolean): NestingInput => ({
    sheet: { width: 420, height: 420 },
    parts: [
      { id: 'frame', w: 400, h: 400, qty: 1, outline: frame, inners: [hole] },
      { id: 'small', w: 80, h: 80, qty: 4, outline: rectPoly(80, 80) },
    ],
    gap: 4,
    margin: 10,
    toolDiameter: 6,
    mode: 'minWaste',
    locked: [],
    engine: 'trueShape',
    partInHole,
  });

  it('off: every footprint is solid, the small parts need a second sheet', () => {
    expect(nest(input(false)).sheetCount).toBe(2);
  });

  it('on: small parts go into the cutout, clear of its toolpath zone (tool + gap)', () => {
    const res = nest(input(true));
    expect(res.sheetCount).toBe(1);
    expect(res.unplaced).toEqual([]);
    const pls = res.layout.sheets[0]?.placements ?? [];
    const host = pls.find((p) => p.partId === 'frame');
    expect(host).toBeDefined();
    // Hole in the sheet frame; every small part at least 10 mm (6 + 4) inside it.
    const hx = (host?.x ?? 0) + 50;
    const hy = (host?.y ?? 0) + 50;
    for (const p of pls.filter((q) => q.partId === 'small')) {
      expect(p.x).toBeGreaterThanOrEqual(hx + 10 - 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(hy + 10 - 1e-6);
      expect(p.x + 80).toBeLessThanOrEqual(hx + 300 - 10 + 1e-6);
      expect(p.y + 80).toBeLessThanOrEqual(hy + 300 - 10 + 1e-6);
    }
  });

  it('cut order: the guest is cut completely before the host inner contour', () => {
    const res = nest(input(true));
    const pls = res.layout.sheets[0]?.placements ?? [];
    const place = (outline: Polyline, pl: { x: number; y: number; rot: number }) => {
      const t = rotate(normalize(outline, 'outer'), pl.rot);
      const b = bbox(t);
      return { dx: pl.x - b.minX, dy: pl.y - b.minY, t };
    };
    const copies = pls.map((pl) => {
      const outline = pl.partId === 'frame' ? frame : rectPoly(80, 80);
      const m = place(outline, pl);
      return {
        key: `${pl.partId}#${pl.index}`,
        outline: translate(m.t, m.dx, m.dy),
        inners: pl.partId === 'frame' ? [translate(rotate(hole, pl.rot), m.dx, m.dy)] : [],
      };
    });
    const hosts = partInHoleHosts(copies);
    expect(hosts.size).toBe(4);
    for (const h of hosts.values()) expect(h).toBe('frame#0');
    // Order items: host inner is small in area, so without the rule it could come first.
    const items: OrderItem[] = [
      { sheet: 0, part: 'frame#0', cls: 'inner', tool: 1, area: 0, starts: [{ x: 0, y: 0 }] },
      { sheet: 0, part: 'frame#0', cls: 'outer', tool: 1, area: 160000, starts: [{ x: 0, y: 0 }] },
      ...[...hosts.keys()].map((k): OrderItem => ({
        sheet: 0,
        part: k,
        cls: 'outer',
        tool: 1,
        area: 6400,
        starts: [{ x: 300, y: 300 }],
        within: 'frame#0',
      })),
    ];
    const seq = cutOrder(items, { mode: 'fastest' }).sequence.map((s) => s.item);
    const innerAt = seq.indexOf(0);
    for (let i = 2; i < items.length; i++) expect(seq.indexOf(i)).toBeLessThan(innerAt);
  });
});
