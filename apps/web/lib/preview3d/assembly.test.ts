import { describe, expect, it } from 'vitest';
import { cabinetParts, DEFAULT_CABINET, type Project } from '@nittcam/core';
import tr from '../../messages/tr.json';
import {
  applyMatrix,
  assemblyFaceMatrix,
  cabinetGroups,
  hasFaceFeatures,
  hasFaceOnlyWork,
  noteThickness,
} from './assembly';

const roles = tr.cutList.cabinet.roles;

function projectWith(parts: unknown[]): Project {
  return {
    stock: { thickness: 18 },
    settings: { dimensionMode: 'finished' },
    parts,
  } as unknown as Project;
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
    edgeBand: x.edgeBand,
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

describe('door holes keep the drawing in the assembly (T310)', () => {
  // Asymmetric handle holes near the top right of the drawing (part frame, y up).
  const handle = [
    { type: 'through', d: 5, cx: 0, cy: 0 },
    { type: 'through', d: 5, cx: 0, cy: 0 },
    { type: 'through', d: 8, cx: 0, cy: 0 },
  ];
  function cabinet(doors: 1 | 2, extra: unknown[] = []) {
    const r = cabinetParts({ ...DEFAULT_CABINET, width: 800, doors });
    if (!r.ok) throw new Error(r.error);
    const rows = r.parts.map((x, i) => {
      const isDoor = x.role === 'door';
      const holes = isDoor
        ? [
            { ...handle[0], cx: x.w - 40, cy: x.h - 60 },
            { ...handle[1], cx: x.w - 40, cy: x.h - 160 },
            { ...handle[2], cx: x.w - 80, cy: x.h - 60 },
            ...extra,
          ]
        : [];
      return {
        id: `c-${i}`,
        name: roles[x.role],
        qty: x.qty,
        group: 'Dolap',
        kind: 'rect',
        params: { w: x.w, h: x.h, r: 0 },
        holes,
        inners: [],
        templates: [],
      };
    });
    const [g] = cabinetGroups(projectWith(rows), roles);
    if (!g) throw new Error('no group');
    const doorsOut = g.assembly.boxes.filter((b) => b.role === 'door');
    return { g, doors: doorsOut };
  }
  const world = (
    g: ReturnType<typeof cabinet>['g'],
    b: ReturnType<typeof cabinet>['doors'][number],
  ) => {
    const part = g.parts.get(b.id);
    if (!part || part.kind !== 'rect') throw new Error('no part');
    const m = assemblyFaceMatrix(b, g.assembly.width, hasFaceOnlyWork(part, b.sz));
    return part.holes.map((h) => applyMatrix(m, h.cx, h.cy, b.sz));
  };

  it('single door, through holes only: seen from the front exactly as drawn', () => {
    const { g, doors } = cabinet(1);
    const [d] = doors;
    if (!d) throw new Error('no door');
    const part = g.parts.get(d.id);
    if (!part || part.kind !== 'rect') throw new Error('no part');
    expect(hasFaceOnlyWork(part, d.sz)).toBe(false);
    const pts = world(g, d);
    part.holes.forEach((h, i) => {
      expect(pts[i]?.[0]).toBeCloseTo(d.x + h.cx, 6);
      expect(pts[i]?.[1]).toBeCloseTo(d.y + h.cy, 6);
    });
  });

  it('single door with hinge cups: top stays top, machined face inside, left/right turned', () => {
    const cup = { type: 'pocket', d: 35, cx: 22, cy: 100, depth: 13 };
    const { g, doors } = cabinet(1, [cup]);
    const [d] = doors;
    if (!d) throw new Error('no door');
    const part = g.parts.get(d.id);
    if (!part || part.kind !== 'rect') throw new Error('no part');
    expect(hasFaceOnlyWork(part, d.sz)).toBe(true);
    const pts = world(g, d);
    part.holes.forEach((h, i) => {
      // vertical order and height as drawn (it was upside down before T310)
      expect(pts[i]?.[1]).toBeCloseTo(d.y + h.cy, 6);
      // seen from the front the inside face is turned over about the vertical axis
      expect(pts[i]?.[0]).toBeCloseTo(d.x + d.sx - h.cx, 6);
      expect(pts[i]?.[2]).toBe(d.z); // on the face toward the carcass
    });
  });

  it('two doors (one row): handles meet in the middle, hinges at the outer edges', () => {
    const cup = { type: 'pocket', d: 35, cx: 22, cy: 100, depth: 13 };
    for (const extra of [[], [cup]]) {
      const { g, doors } = cabinet(2, extra);
      const [L, R] = doors;
      if (!L || !R) throw new Error('two doors expected');
      const mid = g.assembly.width / 2;
      // the big handle hole (drawn near the right edge) is next to the middle on both doors
      const l = world(g, L)[2];
      const r = world(g, R)[2];
      expect(Math.abs((l?.[0] ?? 0) - mid)).toBeLessThan(L.sx / 2);
      expect(Math.abs((r?.[0] ?? 0) - mid)).toBeLessThan(R.sx / 2);
      const tops = [l?.[1] ?? 0, r?.[1] ?? 0].map((y) => y > L.y + L.sy / 2);
      // through work only: both keep the drawing's top; with hinge cups (one row = identical
      // boards) one door is turned 180°
      expect(tops.sort()).toEqual(extra.length === 0 ? [true, true] : [false, true]);
    }
  });
});
