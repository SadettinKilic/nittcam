/** T388: the exact mesh test (three-mesh-bvh) for a non-rectangular part, an L. */
import { describe, expect, it } from 'vitest';
import type { Part } from '@nittcam/core';
import { IDENTITY, qAxisAngle, type LocalBox, type V3 } from './assembly-math';
import { checkFit, type FitPart } from './fit-check';
import { bvhNarrow } from './fit-check-bvh';
import { partMesh } from './part-mesh';

const L = {
  id: 'L',
  kind: 'freeform',
  name: 'L',
  qty: 1,
  grain: { mode: 'free', angle: 0 },
  outline: [
    { x: 0, y: 0, bulge: 0 },
    { x: 200, y: 0, bulge: 0 },
    { x: 200, y: 80, bulge: 0 },
    { x: 80, y: 80, bulge: 0 },
    { x: 80, y: 160, bulge: 0 },
    { x: 0, y: 160, bulge: 0 },
  ],
  inners: [],
  holes: [],
  edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
  templates: [],
} as unknown as Part;

const mesh = partMesh(L, 18);
const lBox: LocalBox = { min: [0, 0, 0], max: [200, 160, 18] };
// The L at identity with its local frame = world frame (centre at the box centre).
const lPart: FitPart = {
  id: 'L',
  box: lBox,
  pose: { position: [100, 80, 9], rotation: IDENTITY },
  holes: [],
  boxy: false,
};
const block = (x0: number, y0: number, w = 100, h = 60): FitPart => ({
  id: 'B',
  box: { min: [0, 0, 0], max: [w, h, 18] },
  pose: { position: [x0 + w / 2, y0 + h / 2, 9] as V3, rotation: IDENTITY },
  holes: [],
  boxy: true,
});
const run = (b: FitPart) => {
  const parts = [lPart, b];
  return checkFit(
    parts,
    bvhNarrow(parts, ['L', null], { L: { positions: mesh.positions, indices: mesh.indices } }),
  );
};

describe('bvhNarrow (T388)', () => {
  it('a block in the empty corner of the L, 10 mm away: no issue (boxes alone would overlap)', () => {
    const r = run(block(90, 90));
    expect(r.issues).toEqual([]);
    expect(r.touching).toBe(0);
    expect(checkFit([lPart, block(90, 90)]).issues[0]).toMatchObject({ kind: 'overlap' });
  });
  it('touching both inner edges of the L is a fit', () => {
    const r = run(block(80, 80));
    expect(r.issues).toEqual([]);
    expect(r.touching).toBe(1);
  });
  it('0,5 mm from the inner edge: gap listed', () => {
    expect(run(block(80.5, 80.5)).issues).toEqual([{ kind: 'gap', a: 'L', b: 'B', gap: 0.5 }]);
  });
  it('2 mm into the arm: overlap depth from the mesh, not the box', () => {
    const r = run(block(78, 90));
    expect(r.issues).toHaveLength(1);
    const o = r.issues[0];
    expect(o?.kind).toBe('overlap');
    if (o?.kind === 'overlap') expect(o.depth).toBeCloseTo(2, 1);
  });
  it('a rotated L (90° about Z) still finds the corner gap', () => {
    const q = qAxisAngle([0, 0, 1], Math.PI / 2);
    // Turned about its box centre (100, 80): the notch is now at x ∈ [20, 100], y ∈ [100, 200].
    const parts: FitPart[] = [
      { ...lPart, pose: { position: [100, 80, 9], rotation: q } },
      block(20, 100.5, 79.5, 99.5),
    ];
    const r = checkFit(
      parts,
      bvhNarrow(parts, ['L', null], { L: { positions: mesh.positions, indices: mesh.indices } }),
    );
    expect(r.issues).toEqual([{ kind: 'gap', a: 'L', b: 'B', gap: 0.5 }]);
  });
});
