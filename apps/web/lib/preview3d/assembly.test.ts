import { describe, expect, it } from 'vitest';
import { cabinetParts, DEFAULT_CABINET, type Project } from '@nittcam/core';
import tr from '../../messages/tr.json';
import { cabinetGroups, noteThickness } from './assembly';

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
