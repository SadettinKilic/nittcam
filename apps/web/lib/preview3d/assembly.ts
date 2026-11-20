/**
 * "Montaj görünümü" input (T158, spec §3.8): the cabinet groups of the cut list, read back from
 * the plain rows (D-041: no link to the generator). A row belongs to a cabinet when it has a group
 * label and the generator's role name ("Yan", "Üst", ...); other parts are not shown. The box
 * positions come from the generator's own layout rules (`cabinetAssembly` in core).
 */
import {
  cabinetAssembly,
  type AssemblyRow,
  type CabinetAssembly,
  type CabinetPartRole,
  type Project,
} from '@nittcam/core';

export interface CabinetGroup {
  group: string;
  assembly: CabinetAssembly;
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
  }
  const out: CabinetGroup[] = [];
  for (const [group, list] of rows) {
    const assembly = cabinetAssembly(list);
    if (assembly) out.push({ group, assembly });
  }
  return out;
}
