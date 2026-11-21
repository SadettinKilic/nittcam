/**
 * "Montaj görünümü" input (T158, spec §3.8): the cabinet groups of the cut list, read back from
 * the plain rows (D-041: no link to the generator). A row belongs to a cabinet when it has a group
 * label and the generator's role name ("Yan", "Üst", ...); other parts are not shown. The box
 * positions come from the generator's own layout rules (`cabinetAssembly` in core).
 */
import {
  cabinetAssembly,
  type AssemblyBox,
  type AssemblyRow,
  type CabinetAssembly,
  type CabinetPartRole,
  type Part,
  type Project,
} from '@nittcam/core';
import { MIN_FLOOR } from './part-mesh';

export interface CabinetGroup {
  group: string;
  assembly: CabinetAssembly;
  /** The cut-list part of each box by row id: its holes, pockets and template instances (T285). */
  parts: ReadonlyMap<string, Part>;
}

const fold = (s: string) => s.trim().toLocaleLowerCase('tr');

/** "8 mm" (the note the generator puts on rows of another thickness, T260) → 8. */
export function noteThickness(note: string | undefined): number | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*mm\s*$/i.exec(note ?? '');
  return m?.[1] ? Number(m[1].replace(',', '.')) : null;
}

/** Cabinet groups of the project in cut-list order; groups without a side and a deck are left out. */
export function cabinetGroups(
  project: Project,
  roles: Readonly<Record<CabinetPartRole, string>>,
): CabinetGroup[] {
  const byName = new Map<string, CabinetPartRole>();
  for (const [role, name] of Object.entries(roles)) byName.set(fold(name), role as CabinetPartRole);
  const rows = new Map<string, AssemblyRow[]>();
  const parts = new Map<string, Map<string, Part>>();
  for (const p of project.parts) {
    if (!p.group || p.kind !== 'rect') continue;
    const role = byName.get(fold(p.name));
    if (!role) continue;
    const list = rows.get(p.group) ?? [];
    list.push({
      role,
      id: p.id,
      qty: p.qty,
      w: p.params.w,
      h: p.params.h,
      thickness: noteThickness(p.note) ?? project.stock.thickness,
    });
    rows.set(p.group, list);
    const byId = parts.get(p.group) ?? new Map<string, Part>();
    byId.set(p.id, p);
    parts.set(p.group, byId);
  }
  const out: CabinetGroup[] = [];
  for (const [group, list] of rows) {
    const assembly = cabinetAssembly(list);
    if (assembly) out.push({ group, assembly, parts: parts.get(group) ?? new Map() });
  }
  return out;
}

/**
 * True when some work of the part is only on its machined face (T310): a blind hole, pocket or
 * groove (not through the board) or a line. Such a door is mounted with that face inside.
 */
export function hasFaceOnlyWork(part: Part, thickness: number): boolean {
  if ((part.lines?.length ?? 0) > 0) return true;
  return part.holes.some((h) => h.type !== 'through' && h.depth < thickness - MIN_FLOOR);
}

/** True when the part has something to show on a face (T285): openings, holes, pockets, lines. */
export function hasFaceFeatures(part: Part): boolean {
  return part.holes.length > 0 || part.inners.length > 0 || (part.lines?.length ?? 0) > 0;
}

type V3 = [number, number, number];

/**
 * Placement of a part's local mesh on its assembled box (T285, spec §3.8). The local frame is the
 * one of T153: x along the part's w, y along its h, z = 0 the sheet bottom and z = T the machined
 * top (where pockets and blind holes start). The machined face goes where the work is done in the
 * cabinet, always by a rotation (never a reflection: the board is the same board):
 * - sides: front edge = local left edge (the generator's edge band), machined face inside; the
 *   right side is the same row turned over, so its local top end is at the bottom;
 * - bottom, shelves: front edge = local bottom edge, machined face up; top: machined face down;
 * - back, plinth: machined face to the front (into the cabinet for the back);
 * - doors (T310, D-098): the drawing's top stays the door's top wherever the boards allow it.
 *   A door with work that must face the carcass (`faceInside`: hinge cups, blind holes, pockets,
 *   grooves, lines) has its machined face inside, so seen from the front it is the drawing turned
 *   over about its vertical axis (left and right swap, a hinge drawn at the local left edge is at
 *   the right). A door with only through holes / cutouts has its machined face to the front and
 *   looks exactly like the drawing. With two doors (one row, identical boards) the left door is
 *   the right one turned 180° in its plane, so their hinges sit at the outer edges and handles
 *   meet in the middle; the left door's drawing is then upside down (unavoidable for one row).
 * `width` is the cabinet width (tells left from right). Returns a column-major 4×4 matrix
 * (`Matrix4.fromArray` order): world = M · (x, y, z, 1), in the cabinet frame.
 */
export function assemblyFaceMatrix(box: AssemblyBox, width: number, faceInside = true): number[] {
  const { x: bx, y: by, z: bz, sx, sy, sz } = box;
  const centre = bx + sx / 2;
  const left = centre <= width / 2 + 1e-6;
  // A single door sits in the middle; with two doors one is clearly left of the middle.
  const leftDoor = centre < width / 2 - 1e-6;
  // The world images of local x, y, z and the world position of the local origin.
  let cx: V3;
  let cy: V3;
  let cz: V3;
  let o: V3;
  switch (box.role) {
    case 'side':
      cx = [0, 0, -1];
      if (left) {
        cy = [0, 1, 0];
        cz = [1, 0, 0];
        o = [bx, by, bz + sz];
      } else {
        cy = [0, -1, 0];
        cz = [-1, 0, 0];
        o = [bx + sx, by + sy, bz + sz];
      }
      break;
    case 'top':
      cx = [-1, 0, 0];
      cy = [0, 0, -1];
      cz = [0, -1, 0];
      o = [bx + sx, by + sy, bz + sz];
      break;
    case 'bottom':
    case 'shelf':
      cx = [1, 0, 0];
      cy = [0, 0, -1];
      cz = [0, 1, 0];
      o = [bx, by, bz + sz];
      break;
    case 'door':
      if (faceInside) {
        cz = [0, 0, -1];
        if (leftDoor) {
          cx = [1, 0, 0];
          cy = [0, -1, 0];
          o = [bx, by + sy, bz + sz];
        } else {
          cx = [-1, 0, 0];
          cy = [0, 1, 0];
          o = [bx + sx, by, bz + sz];
        }
      } else {
        cz = [0, 0, 1];
        if (leftDoor || Math.abs(centre - width / 2) <= 1e-6) {
          cx = [1, 0, 0];
          cy = [0, 1, 0];
          o = [bx, by, bz];
        } else {
          cx = [-1, 0, 0];
          cy = [0, -1, 0];
          o = [bx + sx, by + sy, bz];
        }
      }
      break;
    default: // back, plinth
      cx = [1, 0, 0];
      cy = [0, 1, 0];
      cz = [0, 0, 1];
      o = [bx, by, bz];
  }
  return [...cx, 0, ...cy, 0, ...cz, 0, ...o, 1];
}

/** Applies a column-major 4×4 matrix to a point. */
export function applyMatrix(m: readonly number[], x: number, y: number, z: number): V3 {
  const e = (i: number) => m[i] ?? 0;
  return [
    e(0) * x + e(4) * y + e(8) * z + e(12),
    e(1) * x + e(5) * y + e(9) * z + e(13),
    e(2) * x + e(6) * y + e(10) * z + e(14),
  ];
}
