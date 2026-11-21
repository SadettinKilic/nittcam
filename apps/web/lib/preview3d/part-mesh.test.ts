import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { placedOutline, type Part, type Project } from '@nittcam/core';
import {
  applyTransform,
  circleSegments,
  partMesh,
  placementTransform,
  shapeKey,
  wasteMesh,
  type MeshData,
} from './part-mesh';
import {
  buildSheetScene,
  cachedPartMesh,
  clearMeshCache,
  meshCacheSize,
  partDrawCalls,
} from './sheet-scene';

const T = 18;

function rect(w: number, h: number, extra: Partial<Part> = {}, id = 'p1'): Part {
  return {
    id,
    kind: 'rect',
    name: id,
    qty: 1,
    grain: { mode: 'free', angle: 0 },
    params: { w, h, r: 0 },
    inners: [],
    holes: [],
    edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
    templates: [],
    ...extra,
  } as unknown as Part;
}

/** An L-shaped freeform part with one arc (bulge) on the outer corner. */
const L: Part = {
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
    { x: 80, y: 160, bulge: 0.4142 },
    { x: 0, y: 160, bulge: 0 },
  ],
  inners: [],
  holes: [],
  edgeBand: { top: 0, right: 0, bottom: 0, left: 0 },
  templates: [],
} as unknown as Part;

function bounds(m: MeshData) {
  const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.positions.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const v = m.positions[i + k] ?? 0;
      b[k] = Math.min(b[k] ?? 0, v);
      b[k + 3] = Math.max(b[k + 3] ?? 0, v);
    }
  return b.map((v) => Math.round(v * 1000) / 1000);
}

function vert(m: MeshData, i: number): [number, number, number] {
  return [m.positions[3 * i] ?? 0, m.positions[3 * i + 1] ?? 0, m.positions[3 * i + 2] ?? 0];
}

/**
 * Closed and consistently wound: every directed edge (by position) is matched by exactly one
 * reverse edge. Returns the signed volume (> 0 = normals face outward).
 */
function closedVolume(m: MeshData, strict = true): number {
  const key = (p: [number, number, number]) => p.map((v) => Math.round(v * 1e4)).join(',');
  const edges = new Map<string, number>();
  let vol = 0;
  for (let t = 0; t < m.indices.length; t += 3) {
    const p = [0, 1, 2].map((k) => vert(m, m.indices[t + k] ?? 0)) as [number, number, number][];
    const [a, b, c] = p as [
      [number, number, number],
      [number, number, number],
      [number, number, number],
    ];
    vol +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
    for (let k = 0; k < 3; k++) {
      const from = key(p[k] as [number, number, number]);
      const to = key(p[(k + 1) % 3] as [number, number, number]);
      if (from === to) continue;
      edges.set(`${from}>${to}`, (edges.get(`${from}>${to}`) ?? 0) + 1);
    }
  }
  if (!strict) return vol;
  for (const [e, n] of edges) {
    const [from, to] = e.split('>');
    expect(n, `edge ${e} used ${n}×`).toBe(1);
    expect(edges.get(`${to}>${from}`), `edge ${e} has no twin`).toBe(1);
  }
  return vol;
}

function polyArea(n: number, r: number) {
  return (n / 2) * r * r * Math.sin((2 * Math.PI) / n);
}

describe('part mesh (T153)', () => {
  it('a plain rectangle is a closed box of part bbox × thickness', () => {
    const m = partMesh(rect(100, 50), T);
    expect(bounds(m)).toEqual([0, 0, 0, 100, 50, T]);
    // top 4 + bottom 4 + 4 walls × 4
    expect(m.positions.length / 3).toBe(24);
    expect(m.indices.length / 3).toBe(12);
    expect(m.openings).toBe(0);
    expect(m.edges.length / 6).toBe(8); // top + bottom outline loops
    expect(closedVolume(m)).toBeCloseTo(100 * 50 * T, 3);
  });

  it('a through hole is an opening in both faces with its own wall', () => {
    const m = partMesh(
      rect(100, 50, {
        holes: [{ id: 'h', type: 'through', d: 10, cx: 50, cy: 25, tool: 1 }],
      } as never),
      T,
    );
    const n = circleSegments(5);
    expect(m.openings).toBe(1);
    expect(m.throughOpenings).toBe(1);
    expect(m.positions.length / 3).toBe(2 * (4 + n) + 16 + 4 * n);
    expect(bounds(m)).toEqual([0, 0, 0, 100, 50, T]);
    expect(closedVolume(m)).toBeCloseTo((100 * 50 - polyArea(n, 5)) * T, 2);
  });

  it('a blind pocket is a recess with a floor; the bottom face stays whole', () => {
    const depth = 12;
    const m = partMesh(
      rect(100, 50, {
        holes: [{ id: 'h', type: 'pocket', d: 35, cx: 50, cy: 25, depth, tool: 1 }],
      } as never),
      T,
    );
    const n = circleSegments(17.5);
    expect(m.openings).toBe(1);
    expect(m.throughOpenings).toBe(0);
    // A floor facing up at T - depth.
    let floor = 0;
    for (let i = 0; i < m.positions.length / 3; i++)
      if (Math.abs(vert(m, i)[2] - (T - depth)) < 1e-6 && m.normals[3 * i + 2] === 1) floor++;
    expect(floor).toBe(n);
    expect(closedVolume(m)).toBeCloseTo(100 * 50 * T - polyArea(n, 17.5) * depth, 1);
  });

  it('a ring groove leaves an island at full height and an annular floor', () => {
    const g = { id: 'g', type: 'groove', d: 40, cx: 50, cy: 50, depth: 5, grooveWidth: 8, tool: 1 };
    const m = partMesh(rect(100, 100, { holes: [g] } as never), T);
    expect(m.openings).toBe(1);
    expect(m.throughOpenings).toBe(0);
    const ro = 24;
    const ri = 16;
    const ring = polyArea(circleSegments(ro), ro) - polyArea(circleSegments(ri), ri);
    expect(closedVolume(m)).toBeCloseTo(100 * 100 * T - ring * 5, 1);
    expect(bounds(m)).toEqual([0, 0, 0, 100, 100, T]);
  });

  it('a pocket as deep as the stock is drawn as through', () => {
    const m = partMesh(
      rect(100, 50, {
        holes: [{ id: 'h', type: 'pocket', d: 20, cx: 50, cy: 25, depth: T, tool: 1 }],
      } as never),
      T,
    );
    expect(m.throughOpenings).toBe(1);
    closedVolume(m);
  });

  it('inner contours (cut-outs) go through; arcs are tessellated', () => {
    const inner = [
      { x: 20, y: 20, bulge: 0 },
      { x: 20, y: 40, bulge: 0 },
      { x: 60, y: 40, bulge: 0 },
      { x: 60, y: 20, bulge: 0 },
    ];
    const m = partMesh({ ...L, inners: [inner] } as Part, T);
    expect(m.openings).toBe(1);
    expect(m.throughOpenings).toBe(1);
    const vol = closedVolume(m);
    // L area (with a quarter-circle bulge of radius 40 on the 80→0 top edge segment) minus window.
    expect(vol).toBeGreaterThan((200 * 80 + 80 * 80 - 40 * 20) * T);
    const b = bounds(m);
    expect(b[0]).toBe(0);
    expect(b[3]).toBe(200);
    expect(b[5]).toBe(T);
  });

  it('T325: a rectangular contour pocket is a recess with a flat floor; too deep = through', () => {
    const inner = [
      { x: 20, y: 10, bulge: 0 },
      { x: 20, y: 40, bulge: 0 },
      { x: 80, y: 40, bulge: 0 },
      { x: 80, y: 10, bulge: 0 },
    ];
    const pocket = (depth: number) =>
      partMesh(
        rect(100, 50, { inners: [inner], ops: { inners: [{ kind: 'pocket', depth }] } } as never),
        T,
      );
    const m = pocket(6);
    expect(m.openings).toBe(1);
    expect(m.throughOpenings).toBe(0);
    expect(closedVolume(m)).toBeCloseTo(100 * 50 * T - 60 * 30 * 6, 3);
    const deep = pocket(T);
    expect(deep.throughOpenings).toBe(1);
    expect(closedVolume(deep)).toBeCloseTo((100 * 50 - 60 * 30) * T, 3);
  });

  it('holes of every type, mixed, still give a closed outward mesh', () => {
    const holes = [
      { id: 'a', type: 'through', d: 8, cx: 20, cy: 20, tool: 1 },
      { id: 'b', type: 'pocket', d: 35, cx: 80, cy: 60, depth: 13, tool: 1 },
      { id: 'c', type: 'groove', d: 30, cx: 150, cy: 60, depth: 4, grooveWidth: 6, tool: 1 },
    ];
    const m = partMesh(rect(200, 120, { holes } as never), T);
    expect(m.openings).toBe(3);
    expect(m.throughOpenings).toBe(1);
    expect(closedVolume(m)).toBeGreaterThan(0);
  });
});

describe('placement transform (T153)', () => {
  it('moves the local outline exactly onto core placedOutline at any rotation', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(L, rect(300, 120)),
        fc.double({ min: 0, max: 359.9, noNaN: true }),
        fc.double({ min: 0, max: 2000, noNaN: true }),
        fc.double({ min: 0, max: 1500, noNaN: true }),
        (part, rot, x, y) => {
          const t = placementTransform(part, { x, y, rot });
          const placed = placedOutline(part, { x, y, rot }).vertices;
          const local = placedOutline(part, { x: 0, y: 0, rot: 0 }).vertices;
          // The local frame is the rot-0 outline shifted by its bbox minimum (0 for these parts).
          local.forEach((v, i) => {
            const [px, py] = applyTransform(t, v.x, v.y);
            expect(px).toBeCloseTo(placed[i]?.x ?? NaN, 6);
            expect(py).toBeCloseTo(placed[i]?.y ?? NaN, 6);
          });
        },
      ),
    );
  });
});

describe('sheet scene (T153)', () => {
  function project(
    parts: Part[],
    placements: { partId: string; index: number; x: number; y: number; rot: number }[],
  ) {
    return {
      stock: { thickness: T, sheet: { width: 2800, height: 2070, grain: 0 } },
      parts,
      layout: { sheets: [{ placements: placements.map((p) => ({ ...p, locked: false })) }] },
    } as unknown as Project;
  }

  it('identical parts share one geometry; ids and tools do not split the cache', () => {
    clearMeshCache();
    const a = rect(100, 50, {}, 'a');
    const b = rect(100, 50, { name: 'other' } as never, 'b');
    expect(shapeKey(a, T)).toBe(shapeKey(b, T));
    expect(cachedPartMesh(a, T)).toBe(cachedPartMesh(b, T));
    expect(meshCacheSize()).toBe(1);
    expect(shapeKey(rect(100, 51), T)).not.toBe(shapeKey(a, T));
    expect(shapeKey(a, 19)).not.toBe(shapeKey(a, T));
  });

  it('300 parts stay within 300 draw calls (copies instanced, singles merged)', () => {
    // 300 distinct sizes: everything is merged into one mesh.
    const distinct = Array.from({ length: 300 }, (_, i) => rect(50 + i, 40, {}, `d${i}`));
    const s1 = buildSheetScene(
      project(
        distinct,
        distinct.map((p, i) => ({
          partId: p.id,
          index: 0,
          x: (i % 20) * 140,
          y: Math.floor(i / 20) * 50,
          rot: 0,
        })),
      ),
      0,
    );
    expect(s1.parts).toBe(300);
    expect(s1.instanced).toHaveLength(0);
    expect(partDrawCalls(s1)).toBeLessThanOrEqual(3);

    // 150 shapes × 2 copies: one instanced call per shape.
    const pairs = Array.from({ length: 150 }, (_, i) => rect(50 + i, 40, {}, `q${i}`));
    const s2 = buildSheetScene(
      project(
        pairs,
        pairs.flatMap((p, i) =>
          [0, 1].map((k) => ({
            partId: p.id,
            index: k,
            x: (i % 10) * 250 + k * 120,
            y: Math.floor(i / 10) * 50,
            rot: 0,
          })),
        ),
      ),
      0,
    );
    expect(s2.parts).toBe(300);
    expect(s2.instanced).toHaveLength(150);
    expect(partDrawCalls(s2)).toBeLessThanOrEqual(300);
  });

  it('the merged mesh keeps every vertex of its parts, in the sheet frame', () => {
    const a = rect(100, 50, {}, 'a');
    const s = buildSheetScene(
      project([a], [{ partId: 'a', index: 0, x: 500, y: 300, rot: 90 }]),
      0,
    );
    expect(s.merged).not.toBeNull();
    const m = s.merged as MeshData;
    expect(bounds(m)).toEqual([500, 300, 0, 550, 400, T]);
    expect(s.mergedRefs.map((r) => r.key)).toEqual(['a#0']);
    expect(s.edges.length).toBeGreaterThan(0);
  });

  it('the waste is the sheet with an opening per part and stays closed', () => {
    const outlines = [
      [10, 10, 110, 10, 110, 60, 10, 60],
      [200, 10, 300, 10, 300, 60, 200, 60],
    ];
    const w = wasteMesh({ width: 1000, height: 500 }, T, outlines);
    expect(w.openings).toBe(2);
    // Holes on one row make the triangulator bridge along collinear edges (zero-area triangles),
    // harmless for drawing; the enclosed volume shows the faces and walls are complete.
    expect(closedVolume(w, false)).toBeCloseTo((1000 * 500 - 2 * 100 * 50) * T, 2);
    const staggered = wasteMesh({ width: 1000, height: 500 }, T, [
      outlines[0] ?? [],
      [200, 100, 300, 100, 300, 150, 200, 150],
    ]);
    expect(closedVolume(staggered)).toBeCloseTo((1000 * 500 - 2 * 100 * 50) * T, 2);
  });
});

describe('edge bands and grain data (T154)', () => {
  it('flags only the walls of banded rectangle sides', () => {
    const m = partMesh(
      rect(100, 50, { edgeBand: { top: 1, right: 0, bottom: 2, left: 0 } } as never),
      T,
    );
    const flagged = Array.from(m.bands).filter((b) => b === 1).length;
    expect(flagged).toBe(8); // two wall quads
    // Banded vertices lie on y = 0 or y = 50 (bottom and top sides).
    for (let i = 0; i < m.bands.length; i++)
      if (m.bands[i] === 1) expect([0, 50]).toContain(vert(m, i)[1]);
    expect(partMesh(rect(100, 50), T).bands.every((b) => b === 0)).toBe(true);
  });

  it('a different band splits the geometry cache', () => {
    const banded = rect(100, 50, { edgeBand: { top: 1, right: 0, bottom: 0, left: 0 } } as never);
    expect(shapeKey(banded, T)).not.toBe(shapeKey(rect(100, 50), T));
  });

  it('carries the effective grain per copy and per merged vertex', () => {
    const fixed = rect(100, 50, { grain: { mode: 'fixed', angle: 0 } } as never, 'f');
    const free = rect(80, 40, {}, 'g');
    const p = {
      stock: { thickness: T, sheet: { width: 2800, height: 2070, grain: 30 } },
      parts: [fixed, free],
      layout: {
        sheets: [
          {
            placements: [
              { partId: 'f', index: 0, x: 0, y: 0, rot: 90, locked: false },
              { partId: 'g', index: 0, x: 500, y: 0, rot: 90, locked: false },
            ],
          },
        ],
      },
    } as unknown as Project;
    const s = buildSheetScene(p, 0);
    expect(s.mergedRefs.map((r) => [r.key, r.grain])).toEqual([
      ['f#0', 90],
      ['g#0', 30],
    ]);
    expect(s.wasteGrain).toBe(30);
    const g = s.mergedGrain ?? new Float32Array();
    expect(g.length).toBe((s.merged?.positions.length ?? 0) / 3);
    expect(new Set(g)).toEqual(new Set([90, 30]));
  });
});

describe('contour operations (T142 on main, B19 rider)', () => {
  const window = [
    { x: 20, y: 20, bulge: 0 },
    { x: 20, y: 40, bulge: 0 },
    { x: 60, y: 40, bulge: 0 },
    { x: 60, y: 20, bulge: 0 },
  ];
  it('only cut inner contours open the part; online is an engraved mark, none is solid', () => {
    const base = rect(100, 60, { inners: [window] } as never);
    const cut = partMesh(base, T);
    expect(cut.openings).toBe(1);
    const online = partMesh(
      { ...base, ops: { inners: [{ kind: 'online', depth: 2 }] } } as Part,
      T,
    );
    expect(online.openings).toBe(0);
    expect(online.edges.length / 6).toBe(8 + 4); // outline loops + the engraved window
    expect(closedVolume(online)).toBeCloseTo(100 * 60 * T, 3);
    const none = partMesh({ ...base, ops: { inners: [{ kind: 'none' }] } } as Part, T);
    expect(none.openings).toBe(0);
    expect(none.edges.length / 6).toBe(8);
    expect(shapeKey({ ...base, ops: { inners: [{ kind: 'none' }] } } as Part, T)).not.toBe(
      shapeKey(base, T),
    );
  });

  it('open online lines are drawn on the top face; unmarked lines are not', () => {
    const lines = [
      {
        vertices: [
          { x: 10, y: 10, bulge: 0 },
          { x: 50, y: 10, bulge: 0 },
          { x: 50, y: 30, bulge: 0 },
        ],
        op: { kind: 'online', depth: 1 },
      },
      {
        vertices: [
          { x: 0, y: 0, bulge: 0 },
          { x: 5, y: 5, bulge: 0 },
        ],
        op: { kind: 'none' },
      },
    ];
    const m = partMesh(rect(100, 60, { lines } as never), T);
    expect(m.edges.length / 6).toBe(8 + 2);
    let top = 0;
    for (let i = 0; i < m.edges.length; i += 6)
      if (m.edges[i + 2] === T && m.edges[i + 5] === T) top++;
    expect(top).toBe(4 + 2); // top outline + the engraved line
  });
});
