import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Part, Project } from '@nittcam/core';
import { drawnParts } from '../components/layout-view/model';

// Tester (B6, T116/T117, D-034): the layout model draws each fixed-grain part's arrow at the
// effective sheet-frame angle (part grain + placement rotation, mod 180), free parts get no
// arrow, and the drawn outline of a turned part fills its footprint exactly.

function rect(id: string, w: number, h: number, grain: Part['grain']): Part {
  return {
    id,
    kind: 'rect',
    name: id,
    qty: 1,
    grain,
    params: { w, h, r: 0 },
    inners: [],
    holes: [],
    edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
  } as unknown as Part;
}

function project(parts: Part[], rots: number[]): Project {
  return {
    parts,
    layout: {
      sheets: [
        {
          placements: parts.map((p, i) => ({
            partId: p.id,
            index: 0,
            x: 10 + i * 900,
            y: 10,
            rot: rots[i] ?? 0,
            locked: false,
          })),
        },
      ],
    },
  } as unknown as Project;
}

const norm = (a: number) => {
  const r = Math.round((((a % 180) + 180) % 180) * 1000) / 1000;
  return r >= 180 ? 0 : r;
};

describe('layout model: grain arrow angle and turned outline (tester)', () => {
  it('T117 case: A 0°/B 90°/C 30° at their allowed rotations all point along the 0° sheet grain', () => {
    const parts = [
      rect('A', 400, 700, { mode: 'fixed', angle: 0 }),
      rect('B', 300, 500, { mode: 'fixed', angle: 90 }),
      rect('C', 300, 600, { mode: 'fixed', angle: 30 }),
    ];
    for (const rots of [
      [0, 90, 330],
      [180, 270, 150],
    ]) {
      const drawn = drawnParts(project(parts, rots), 0);
      expect(drawn.map((d) => d.grainAngle)).toEqual([0, 0, 0]);
    }
  });

  it('a free part has no arrow, whatever its stored angle', () => {
    const drawn = drawnParts(project([rect('F', 300, 200, { mode: 'free', angle: 30 })], [90]), 0);
    expect(drawn[0]?.grainAngle).toBeNull();
  });

  it('property: arrow angle = normalise(part grain + rot), in [0, 180)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1799 }).map((v) => v / 10),
        fc.integer({ min: 0, max: 3599 }).map((v) => v / 10),
        (angle, rot) => {
          const d = drawnParts(
            project([rect('P', 300, 200, { mode: 'fixed', angle })], [rot]),
            0,
          )[0];
          expect(d).toBeDefined();
          const g = d?.grainAngle ?? -1;
          expect(g).toBeGreaterThanOrEqual(0);
          expect(g).toBeLessThan(180);
          expect(g).toBeCloseTo(norm(angle + rot), 3);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('property: a turned rectangle outline is the part (same area, 4 corners) and spans its footprint', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 50, max: 1200 }),
        fc.integer({ min: 50, max: 1200 }),
        fc
          .integer({ min: 1, max: 3599 })
          .filter((v) => v % 900 !== 0)
          .map((v) => v / 10),
        (w, h, rot) => {
          const d = drawnParts(
            project([rect('P', w, h, { mode: 'fixed', angle: 0 })], [rot]),
            0,
          )[0];
          if (!d) throw new Error('not drawn');
          const pts = d.outline;
          expect(pts).not.toBeNull();
          const xs = (pts ?? []).filter((_, i) => i % 2 === 0);
          const ys = (pts ?? []).filter((_, i) => i % 2 === 1);
          expect(xs).toHaveLength(4);
          expect(Math.min(...xs)).toBeCloseTo(0, 2);
          expect(Math.max(...xs)).toBeCloseTo(d.w, 2);
          expect(Math.min(...ys)).toBeCloseTo(0, 2);
          expect(Math.max(...ys)).toBeCloseTo(d.h, 2);
          let area = 0;
          for (let i = 0; i < xs.length; i++) {
            const j = (i + 1) % xs.length;
            area += (xs[i] ?? 0) * (ys[j] ?? 0) - (xs[j] ?? 0) * (ys[i] ?? 0);
          }
          expect(Math.abs(Math.abs(area) / 2 - w * h) / (w * h)).toBeLessThan(1e-4);
          // The first edge runs at the rotation angle (canvas Y is down, so −dy).
          const a =
            (Math.atan2(-((ys[1] ?? 0) - (ys[0] ?? 0)), (xs[1] ?? 0) - (xs[0] ?? 0)) * 180) /
            Math.PI;
          const diff = (((a - rot) % 90) + 90) % 90;
          expect(Math.min(diff, 90 - diff)).toBeLessThan(0.05);
        },
      ),
      { numRuns: 150 },
    );
  });
});
