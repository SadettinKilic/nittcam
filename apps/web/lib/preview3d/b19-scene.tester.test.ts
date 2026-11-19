/**
 * B19 tester (T153, T154): the 3D scene as data against the 2D layout view model and core.
 * - grain: a fixed part's texture direction equals the 2D grain arrow (part grain + rotation) at
 *   0°/30°/90° part grain and every quarter turn; a free part follows the sheet grain (or 0)
 * - placement: every mesh vertex of every copy lands inside the 2D footprint box, and the mesh
 *   bbox fills it (any rotation, rect and freeform)
 * - blind vs through: only through holes change the bottom face
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { normalizeGrain, type Part, type Project } from '@nittcam/core';
import { drawnParts } from '../../components/layout-view/model';
import { applyTransform, partMesh } from './part-mesh';
import { buildSheetScene, type InstanceRef } from './sheet-scene';

const T = 18;

function rect(id: string, w: number, h: number, grain: Part['grain'], holes: unknown[] = []) {
  return {
    id,
    kind: 'rect',
    name: id,
    qty: 1,
    grain,
    params: { w, h, r: 0 },
    inners: [],
    holes,
    edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
    templates: [],
  } as unknown as Part;
}

function project(parts: Part[], rots: number[], sheetGrain: number | null): Project {
  return {
    stock: { thickness: T, sheet: { width: 2800, height: 2070, grain: sheetGrain } },
    parts,
    layout: {
      sheets: [
        {
          placements: parts.flatMap((p, i) =>
            rots.map((rot, k) => ({
              partId: p.id,
              index: k,
              x: 50 + k * 600,
              y: 50 + i * 600,
              rot,
              locked: false,
            })),
          ),
        },
      ],
    },
  } as unknown as Project;
}

const allRefs = (p: Project) => {
  const s = buildSheetScene(p, 0);
  return [
    ...s.instanced.flatMap((g) => g.instances.map((r) => ({ r, g }))),
    ...s.mergedRefs.map((r) => ({ r, g: null })),
  ];
};

describe('B19 tester: grain direction 3D = 2D', () => {
  it.each([0, 30, 90])(
    'fixed part grain %d°: equals the 2D arrow at every quarter turn',
    (angle) => {
      const rots = [0, 90, 180, 270];
      for (const sheetGrain of [null, 0, 45]) {
        const p = project([rect('f', 300, 120, { mode: 'fixed', angle })], rots, sheetGrain);
        const twoD = new Map(drawnParts(p, 0).map((d) => [d.key, d.grainAngle]));
        const refs: InstanceRef[] = buildSheetScene(p, 0).instanced.flatMap((g) => g.instances);
        expect(refs).toHaveLength(4);
        for (const r of refs) {
          expect(r.grain).toBeCloseTo(twoD.get(r.key) as number, 9);
          expect(r.grain).toBeCloseTo(normalizeGrain(angle + r.transform.rot), 9);
        }
      }
    },
  );

  it('free parts show the sheet grain (0 without one), whatever their rotation', () => {
    for (const sheetGrain of [null, 0, 30, 90]) {
      const p = project([rect('g', 300, 120, { mode: 'free', angle: 0 })], [0, 90], sheetGrain);
      const refs = buildSheetScene(p, 0).instanced.flatMap((g) => g.instances);
      for (const r of refs) expect(r.grain).toBe(sheetGrain ?? 0);
    }
  });
});

describe('B19 tester: placement equals the 2D footprint', () => {
  it('property: every vertex inside the 2D footprint box; bbox fills it', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 20, max: 900 }),
        fc.integer({ min: 20, max: 900 }),
        fc.constantFrom(0, 90, 180, 270, 30, 137.5),
        (w, h, rot) => {
          const p = project([rect('a', w, h, { mode: 'free', angle: 0 })], [rot], null);
          const fp = drawnParts(p, 0)[0];
          const ref = allRefs(p)[0];
          if (!fp || !ref) return false;
          const mesh = partMesh(p.parts[0] as Part, T);
          let minX = Infinity;
          let minY = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          for (let i = 0; i < mesh.positions.length; i += 3) {
            const [x, y] = applyTransform(
              ref.r.transform,
              mesh.positions[i] as number,
              mesh.positions[i + 1] as number,
            );
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
          const eps = 1e-3;
          expect(minX).toBeCloseTo(fp.x, 2);
          expect(minY).toBeCloseTo(fp.y, 2);
          expect(maxX - minX).toBeLessThanOrEqual(fp.w + eps);
          expect(maxY - minY).toBeLessThanOrEqual(fp.h + eps);
          expect(maxX - minX).toBeCloseTo(fp.w, 2);
          expect(maxY - minY).toBeCloseTo(fp.h, 2);
          return true;
        },
      ),
      { numRuns: 120 },
    );
  });
});

describe('B19 tester: blind vs through', () => {
  const bottomArea = (part: Part) => {
    const m = partMesh(part, T);
    // Area of the triangles lying on z = 0 (the bottom face).
    let area = 0;
    const idx = m.indices;
    const P = m.positions;
    for (let i = 0; i < idx.length; i += 3) {
      const [a, b, c] = [idx[i], idx[i + 1], idx[i + 2]].map((k) => (k as number) * 3) as [
        number,
        number,
        number,
      ];
      if (Math.abs(P[a + 2] as number) > 1e-6) continue;
      if (Math.abs(P[b + 2] as number) > 1e-6 || Math.abs(P[c + 2] as number) > 1e-6) continue;
      const ux = (P[b] as number) - (P[a] as number);
      const uy = (P[b + 1] as number) - (P[a + 1] as number);
      const vx = (P[c] as number) - (P[a] as number);
      const vy = (P[c + 1] as number) - (P[a + 1] as number);
      area += Math.abs(ux * vy - uy * vx) / 2;
    }
    return area;
  };
  const free = { mode: 'free', angle: 0 } as const;
  const hole = (type: string, extra: object = {}) => ({
    id: 'h',
    type,
    d: 40,
    cx: 100,
    cy: 60,
    tool: 1,
    ...extra,
  });

  it('a blind pocket keeps the whole bottom; a through hole removes its disc', () => {
    const plain = bottomArea(rect('a', 200, 120, free));
    expect(plain).toBeCloseTo(200 * 120, 0);
    expect(bottomArea(rect('a', 200, 120, free, [hole('pocket', { depth: 8 })]))).toBeCloseTo(
      plain,
      0,
    );
    const through = bottomArea(rect('a', 200, 120, free, [hole('through')]));
    // Tessellated circle: within 1 % of π r².
    expect(plain - through).toBeGreaterThan(Math.PI * 400 * 0.99);
    expect(plain - through).toBeLessThanOrEqual(Math.PI * 400 + 1e-6);
    // A pocket as deep as the stock is drawn as through.
    expect(bottomArea(rect('a', 200, 120, free, [hole('pocket', { depth: T })]))).toBeCloseTo(
      through,
      3,
    );
  });
});

describe('B19 tester: automatic Basit mod on very slow machines', () => {
  // KNOWN BUG (B19 tester): frames further apart than `gapMs` (250 ms, i.e. below 4 fps) reset the
  // run, so the slowest machines never get the automatic switch. `it.fails` documents it; when
  // FpsWatch is fixed this test starts failing: turn it into a plain `it`.
  it.fails('fires during a continuous orbit at 3 fps', async () => {
    const { FpsWatch } = await import('./fps');
    const w = new FpsWatch();
    let fired = 0;
    for (let t = 0; t <= 6000; t += 333) if (w.frame(t)) fired++;
    expect(fired).toBe(1);
  });
});
