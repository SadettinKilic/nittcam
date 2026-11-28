import { traitsOf, type Part } from '@nittcam/core';
import { describe, expect, it } from 'vitest';
import { partMesh } from './part-mesh';
import { offsetChain, vGrooveEdges } from './vgroove-3d';

// T353: the 3D draws a V-groove as its V section (edges on the machined face, bottom at depth).
const traits = traitsOf('acm').vGroove as NonNullable<ReturnType<typeof traitsOf>['vGroove']>;
const part = {
  id: 'a',
  name: 'A',
  qty: 1,
  kind: 'rect',
  params: { w: 200, h: 100, r: 0 },
  grain: { mode: 'free', angle: 0 },
  inners: [],
  holes: [],
  edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
  templates: [],
  lines: [
    {
      vertices: [
        { x: 0, y: 50, bulge: 0 },
        { x: 200, y: 50, bulge: 0 },
      ],
      op: { kind: 'vgroove' },
    },
  ],
} as unknown as Part;

describe('V-groove 3D section (T353)', () => {
  it('back face: edges at z = 0, 6,4 mm apart (4 mm, 0,8 left, 90°), bottom at z = 3,2', () => {
    const e = vGrooveEdges(part, 4, { angleDeg: 90, tipDiameter: 0, traits, face: 'back' });
    const zs = new Set<number>();
    const ys = new Set<number>();
    for (let i = 0; i < e.length; i += 3) {
      zs.add(Math.round((e[i + 2] ?? 0) * 1000) / 1000);
      ys.add(Math.round((e[i + 1] ?? 0) * 1000) / 1000);
    }
    expect([...zs].sort()).toEqual([0, 3.2]);
    expect([...ys].sort((a, b) => a - b)).toEqual([46.8, 50, 53.2]);
  });

  it('front face: edges on the top face; no groove → no edges; the mesh adds them', () => {
    const e = vGrooveEdges(part, 4, { angleDeg: 90, tipDiameter: 0, traits, face: 'front' });
    expect(Math.max(...e.filter((_, i) => i % 3 === 2))).toBe(4);
    const none = { ...part, lines: [] } as unknown as Part;
    expect(vGrooveEdges(none, 4, { angleDeg: 90, tipDiameter: 0, traits, face: 'back' })).toEqual(
      [],
    );
    const plain = partMesh(part, 4).edges.length;
    const grooved = partMesh(part, 4, { angleDeg: 90, tipDiameter: 0, traits, face: 'back' }).edges
      .length;
    expect(grooved).toBeGreaterThan(plain);
  });

  it('offsetChain keeps the distance on a straight chain', () => {
    const o = offsetChain(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      2,
      false,
    );
    expect(o).toEqual([
      { x: 0, y: 2 },
      { x: 10, y: 2 },
    ]);
  });
});
