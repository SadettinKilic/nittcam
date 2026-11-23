import { describe, expect, it } from 'vitest';
import { cabinetParts, DEFAULT_CABINET, type Project } from '@nittcam/core';
import tr from '../../messages/tr.json';
import { applyMatrix, assemblyFaceMatrix, cabinetGroups, hasFaceOnlyWork } from './assembly';

// T310 tester: a two-door row whose doors have only through holes (asymmetric handle holes, no
// hinge cups) can show both doors with the drawing's top on top: a board with only through work
// may be turned over about its vertical axis, so the handles meet in the middle at the drawn
// height on both doors. With hinge cups (face-only work) the 180° turn is unavoidable (D-101).

const roles = tr.cutList.cabinet.roles;

function doorsOf(doors: 1 | 2, cup: boolean) {
  const r = cabinetParts({ ...DEFAULT_CABINET, width: 800, doors });
  if (!r.ok) throw new Error(r.error);
  const rows = r.parts.map((x, i) => ({
    id: `c-${i}`,
    name: roles[x.role],
    qty: x.qty,
    group: 'Dolap',
    kind: 'rect',
    params: { w: x.w, h: x.h, r: 0 },
    holes:
      x.role === 'door'
        ? [
            { type: 'through', d: 5, cx: x.w - 40, cy: x.h - 60 },
            { type: 'through', d: 5, cx: x.w - 40, cy: x.h - 160 },
            ...(cup ? [{ type: 'pocket', d: 35, cx: 22, cy: 100, depth: 13 }] : []),
          ]
        : [],
    inners: [],
    templates: [],
  }));
  const [g] = cabinetGroups({ stock: { thickness: 18 }, parts: rows } as unknown as Project, roles);
  if (!g) throw new Error('no group');
  return g.assembly.boxes
    .filter((b) => b.role === 'door')
    .map((b) => {
      const part = g.parts.get(b.id);
      if (!part || part.kind !== 'rect') throw new Error('no part');
      const m = assemblyFaceMatrix(b, g.assembly.width, hasFaceOnlyWork(part, b.sz));
      // Seen from the front: height above the door bottom of the first handle hole.
      const hole = part.holes[0];
      if (!hole) throw new Error('no hole');
      const p = applyMatrix(m, hole.cx, hole.cy, b.sz);
      return { box: b, height: (p[1] ?? 0) - b.y, x: p[0] ?? 0, mid: g.assembly.width / 2 };
    });
}

describe('T310 tester: two doors with through holes only', () => {
  it('both doors keep the drawn handle height and the handles meet in the middle', () => {
    const doors = doorsOf(2, false);
    expect(doors).toHaveLength(2);
    for (const d of doors) {
      expect(Math.abs(d.x - d.mid)).toBeLessThan(d.box.sx / 2);
      // drawn near the top: 60 mm below the top edge
      expect(d.height, `door at x=${d.box.x}`).toBeCloseTo(d.box.sy - 60, 6);
    }
  });

  it('single door, with or without a hinge cup: handle at the drawn height', () => {
    for (const cup of [false, true]) {
      const [d] = doorsOf(1, cup);
      if (!d) throw new Error('no door');
      expect(d.height).toBeCloseTo(d.box.sy - 60, 6);
    }
  });
});
