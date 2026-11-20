import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  cabinetAssembly,
  cabinetParts,
  DEFAULT_CABINET,
  type AssemblyBox,
  type AssemblyRow,
  type CabinetParams,
} from './cabinet';

/** The generator's rows as the assembly view reads them (one id per role). */
function rowsOf(params: CabinetParams): AssemblyRow[] {
  const r = cabinetParts(params);
  if (!r.ok) throw new Error(r.error);
  return r.parts.map((p) => ({
    role: p.role,
    id: p.role,
    qty: p.qty,
    w: p.w,
    h: p.h,
    thickness: p.thickness,
  }));
}

function assembled(params: CabinetParams) {
  const a = cabinetAssembly(rowsOf(params));
  if (!a) throw new Error('no assembly');
  return a;
}
const byRole = (a: { boxes: AssemblyBox[] }, role: string) =>
  a.boxes.filter((b) => b.role === role);
/** Box `i` of a role (throws when missing, so no non-null assertions). */
function box(a: { boxes: AssemblyBox[] }, role: string, i = 0): AssemblyBox {
  const b = byRole(a, role)[i];
  if (!b) throw new Error(`no ${role} ${i}`);
  return b;
}

describe('cabinetAssembly (T158)', () => {
  it('default cabinet: outer size, sides at the ends, deck between, door in front', () => {
    const a = assembled(DEFAULT_CABINET);
    expect(a.width).toBe(600);
    expect(a.height).toBe(720);
    expect(byRole(a, 'side').map((s) => s.x)).toEqual([0, 582]);
    expect(box(a, 'side')).toMatchObject({ sx: 18, sy: 720, sz: 560, z: 0 });
    const top = box(a, 'top');
    expect(top).toMatchObject({ x: 18, y: 702, sx: 564, sy: 18, sz: 552, z: 8 });
    const bottom = box(a, 'bottom');
    expect(bottom).toMatchObject({ y: 0, z: 8 });
    const back = box(a, 'back');
    expect(back).toMatchObject({ x: 18, z: 0, sx: 564, sy: 720, sz: 8 });
    const door = box(a, 'door');
    expect(door).toMatchObject({ x: 3, y: 3, z: 560, sx: 594, sy: 714 });
    expect(byRole(a, 'shelf')).toHaveLength(1);
  });

  it('plinth, two doors, overlay back and three shelves', () => {
    const params: CabinetParams = {
      ...DEFAULT_CABINET,
      width: 800,
      plinth: 100,
      doors: 2,
      shelves: 3,
      back: { mode: 'overlay', thickness: 8 },
    };
    const a = assembled(params);
    expect(a.width).toBe(800);
    expect(box(a, 'bottom', 0).y).toBe(100);
    expect(byRole(a, 'plinth')[0]).toMatchObject({ y: 0, sy: 100, sx: 764 });
    const back = box(a, 'back', 0);
    expect(back).toMatchObject({ x: 0, z: 0, sx: 800 });
    expect(box(a, 'side', 0).z).toBe(8); // behind the sides
    const doors = byRole(a, 'door');
    expect(doors).toHaveLength(2);
    expect(box(a, 'door', 0).x).toBeCloseTo(3);
    expect(box(a, 'door', 1).x + box(a, 'door', 1).sx).toBeCloseTo(797);
    const ys = byRole(a, 'shelf').map((s) => s.y);
    expect(ys).toHaveLength(3);
    const [y0 = 0, y1 = 0, y2 = 0] = ys;
    expect(y1 - y0).toBeCloseTo(y2 - y1);
  });

  it('null without a side or without a top/bottom', () => {
    const rows = rowsOf(DEFAULT_CABINET);
    expect(cabinetAssembly(rows.filter((r) => r.role !== 'side'))).toBeNull();
    expect(cabinetAssembly(rows.filter((r) => r.role !== 'top' && r.role !== 'bottom'))).toBeNull();
  });

  it('every board stays inside the box and between the sides (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 300, max: 1200 }),
        fc.integer({ min: 400, max: 2400 }),
        fc.integer({ min: 300, max: 700 }),
        fc.integer({ min: 0, max: 5 }),
        fc.constantFrom(0, 1, 2),
        fc.constantFrom('none', 'inset', 'overlay'),
        fc.integer({ min: 0, max: 150 }),
        (width, height, depth, shelves, doors, mode, plinth) => {
          const params: CabinetParams = {
            ...DEFAULT_CABINET,
            width,
            height,
            depth,
            shelves,
            doors: doors as 0 | 1 | 2,
            plinth,
            back: { mode: mode as 'none' | 'inset' | 'overlay', thickness: 8 },
          };
          if (!cabinetParts(params).ok) return;
          const a = assembled(params);
          expect(a.width).toBeCloseTo(width, 0);
          for (const b of a.boxes) {
            expect(b.x).toBeGreaterThanOrEqual(-0.5);
            expect(b.x + b.sx).toBeLessThanOrEqual(width + 0.5);
            expect(b.y).toBeGreaterThanOrEqual(-0.5);
            expect(b.y + b.sy).toBeLessThanOrEqual(height + 0.5);
            expect(b.z).toBeGreaterThanOrEqual(-0.5);
            expect(Math.min(b.sx, b.sy, b.sz)).toBeGreaterThan(0);
          }
        },
      ),
    );
  });
});
