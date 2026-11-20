import { describe, expect, it } from 'vitest';
import { cabinetParts, DEFAULT_CABINET, type Project } from '@nittcam/core';
import tr from '../../messages/tr.json';
import {
  applyMatrix,
  assemblyFaceMatrix,
  cabinetGroups,
  hasFaceFeatures,
  noteThickness,
} from './assembly';

const roles = tr.cutList.cabinet.roles;

function projectWith(parts: unknown[]): Project {
  return { stock: { thickness: 18 }, parts } as unknown as Project;
}

function generated(group: string, width = 600) {
  const r = cabinetParts({ ...DEFAULT_CABINET, width });
  if (!r.ok) throw new Error(r.error);
  // as the "Dolap ekle" dialog adds them (cabinetRows): role name, group, "8 mm" note
  return r.parts.map((x, i) => ({
    id: `${group}-${i}`,
    name: roles[x.role],
    qty: x.qty,
    group,
    ...(x.thickness !== 18 ? { note: `${x.thickness} mm` } : {}),
    kind: 'rect',
    params: { w: x.w, h: x.h, r: 0 },
    holes: [] as unknown[],
    inners: [] as unknown[],
  }));
}

describe('cabinetGroups (T158)', () => {
  it('one assembly per cabinet group, sized like the generator', () => {
    const p = projectWith([...generated('Dolap 1'), ...generated('Dolap 2', 900)]);
    const g = cabinetGroups(p, roles);
    expect(g.map((x) => [x.group, x.assembly.width, x.assembly.height])).toEqual([
      ['Dolap 1', 600, 720],
      ['Dolap 2', 900, 720],
    ]);
    // the 8 mm back is read from its note
    const back = g[0]?.assembly.boxes.find((b) => b.role === 'back');
    expect(back?.sz).toBe(8);
  });

  it('non-cabinet parts are not shown: no group, unknown name, freeform', () => {
    const rows = generated('Dolap 1');
    const p = projectWith([
      ...rows.map((r) => (r.name === roles.door ? { ...r, kind: 'freeform' } : r)),
      { id: 'x', name: 'Raf', qty: 1, kind: 'rect', params: { w: 500, h: 300, r: 0 } },
      {
        id: 'y',
        name: 'Masa',
        group: 'Dolap 1',
        qty: 1,
        kind: 'rect',
        params: { w: 1, h: 1, r: 0 },
      },
    ]);
    const [g] = cabinetGroups(p, roles);
    const ids = new Set(g?.assembly.boxes.map((b) => b.id));
    expect(ids.has('x')).toBe(false);
    expect(ids.has('y')).toBe(false);
    expect(g?.assembly.boxes.some((b) => b.role === 'door')).toBe(false);
  });

  it('a group without sides is left out', () => {
    const p = projectWith(generated('Dolap 1').filter((r) => r.name !== roles.side));
    expect(cabinetGroups(p, roles)).toEqual([]);
  });

  it('noteThickness reads "8 mm" and "4,5 mm" only', () => {
    expect(noteThickness('8 mm')).toBe(8);
    expect(noteThickness('4,5 mm')).toBe(4.5);
    expect(noteThickness('beyaz')).toBeNull();
    expect(noteThickness(undefined)).toBeNull();
  });
});

describe('assemblyFaceMatrix (T285)', () => {
  const twoDoors = () => {
    const rows = generated('Dolap 1', 800).map((r) =>
      r.name === roles.door
        ? { ...r, qty: 2, holes: [{ type: 'pocket', d: 35, cx: 22, cy: 100, depth: 13 }] }
        : r,
    );
    const [g] = cabinetGroups(projectWith(rows), roles);
    if (!g) throw new Error('no group');
    return g;
  };
  const thick = (b: { role: string; sx: number; sy: number; sz: number }) =>
    b.role === 'side' ? b.sx : ['top', 'bottom', 'shelf'].includes(b.role) ? b.sy : b.sz;
  const det = (m: number[]) => {
    const [a, b, c, , d, e, f, , g, h, i] = m.map((v) => v) as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    return a * (e * i - f * h) - d * (b * i - c * h) + g * (b * f - c * e);
  };

  it('maps every board onto its box by a rotation (no reflection)', () => {
    const g = twoDoors();
    for (const b of g.assembly.boxes) {
      const part = g.parts.get(b.id);
      if (!part || part.kind !== 'rect') throw new Error('no part');
      const m = assemblyFaceMatrix(b, g.assembly.width);
      expect(det(m)).toBe(1);
      const a = applyMatrix(m, 0, 0, 0);
      const z = applyMatrix(m, part.params.w, part.params.h, thick(b));
      const lo = a.map((v, k) => Math.min(v, z[k] ?? 0));
      const hi = a.map((v, k) => Math.max(v, z[k] ?? 0));
      const near = (v: number[], w: number[]) =>
        v.forEach((x, k) => expect(x).toBeCloseTo(w[k] ?? NaN, 6));
      near(lo, [b.x, b.y, b.z]);
      near(hi, [b.x + b.sx, b.y + b.sy, b.z + b.sz]);
    }
  });

  it('hinge cups land on the inside face at the outer edge of each door', () => {
    const g = twoDoors();
    const doors = g.assembly.boxes.filter((b) => b.role === 'door');
    expect(doors).toHaveLength(2);
    const [l, r] = doors.map((b) =>
      applyMatrix(assemblyFaceMatrix(b, g.assembly.width), 22, 100, b.sz),
    );
    const [L, R] = doors as [(typeof doors)[0], (typeof doors)[0]];
    const door = g.parts.get(L.id);
    expect(door && hasFaceFeatures(door)).toBe(true);
    // machined top (local z = T) = the door face toward the carcass
    expect(l?.[2]).toBe(L.z);
    expect(r?.[2]).toBe(R.z);
    // left door: hinge at its left edge; right door (same row turned): at its right edge
    expect(l?.[0]).toBeCloseTo(L.x + 22, 6);
    expect(r?.[0]).toBeCloseTo(R.x + R.sx - 22, 6);
  });

  it('side holes face into the cabinet on both sides', () => {
    const g = twoDoors();
    const sides = g.assembly.boxes.filter((b) => b.role === 'side');
    const faces = sides.map(
      (b) => applyMatrix(assemblyFaceMatrix(b, g.assembly.width), 37, 32, b.sx)[0],
    );
    expect(faces).toEqual([18, 800 - 18]);
    // front edge = local left edge
    const [s0] = sides as [(typeof sides)[0]];
    const front = applyMatrix(assemblyFaceMatrix(s0, g.assembly.width), 0, 0, 0)[2];
    expect(front).toBe(s0.z + s0.sz);
  });

  it('a plain board has no face features', () => {
    const g = twoDoors();
    const side = g.assembly.boxes.find((b) => b.role === 'side');
    const part = side ? g.parts.get(side.id) : undefined;
    expect(part ? hasFaceFeatures(part) : null).toBe(false);
  });
});
