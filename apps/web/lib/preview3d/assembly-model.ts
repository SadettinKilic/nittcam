/**
 * Montaj tezgâhı model (T386, D-131): one item per part copy, at its stored place
 * (`project.assembly`) or, never moved yet, at its seeded place. Seeds: cabinet-generator boards
 * stand in their box (T158 `assemblyFaceMatrix`), every other part lies flat (machined face up) in
 * rows on the bench in front of the cabinets. Display only.
 */
import {
  assemblyInstanceId,
  materialKindOf,
  type AssemblyInstance,
  type MaterialKind,
  type CabinetPartRole,
  type Part,
  type Project,
} from '@nittcam/core';
import {
  assemblyFaceMatrix,
  cabinetGroups,
  hasFaceOnlyWork,
  noteThickness,
  rowLayout,
} from './assembly';
import type { MeshData } from './part-mesh';
import { cachedPartMesh } from './sheet-scene';
import {
  boxCentre,
  boxSize,
  poseFromMatrix,
  roundPose,
  type LocalBox,
  type Pose,
  type Quat,
} from './assembly-math';

/** Lying flat, machined face up: local x → world x, local y → world −z, local z → world y. */
export const FLAT: Quat = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];
/** Gap between two parts on the bench, mm. */
export const BENCH_GAP = 50;
/** Distance from the cabinets to the first bench row, mm. */
export const BENCH_FRONT = 300;

export interface BenchItem {
  /** `<partId>#<copy>` */
  id: string;
  partId: string;
  copy: number;
  part: Part;
  /** Board thickness, mm (the generator's note for other-thickness rows, else the stock's). */
  thickness: number;
  mesh: MeshData;
  box: LocalBox;
  seed: Pose;
  pose: Pose;
  hidden: boolean;
  /** True when the pose is stored in the project (moved at least once). */
  placed: boolean;
  /** Cabinet boards only: their role and group (for the part list). */
  role?: CabinetPartRole;
  group?: string;
  /** Doors are drawn see-through (T158). */
  door: boolean;
  /** T390: the look it is drawn with (its own material in the assembly, else the stock's). */
  look: MaterialKind;
  /** T390: true when the part is shown in its own material (not the stock's). */
  ownLook: boolean;
}

const boxes = new WeakMap<MeshData, LocalBox>();

/** Local bounds of a part mesh (cached per mesh). */
export function localBoxOf(mesh: MeshData): LocalBox {
  const hit = boxes.get(mesh);
  if (hit) return hit;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const p = mesh.positions;
  for (let i = 0; i + 2 < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = p[i + k] ?? 0;
      if (v < (min[k] ?? 0)) min[k] = v;
      if (v > (max[k] ?? 0)) max[k] = v;
    }
  }
  const out: LocalBox = min[0] === Infinity ? { min: [0, 0, 0], max: [0, 0, 0] } : { min, max };
  boxes.set(mesh, out);
  return out;
}

/**
 * Board thickness of a part on the bench: its own look's (T390, mixed materials), else the
 * generator's note for other-thickness rows, else the stock's.
 */
export function partThickness(part: Part, project: Project): number {
  const own = project.assembly?.parts?.find((p) => p.partId === part.id);
  return own?.thickness ?? noteThickness(part.note) ?? project.stock.thickness;
}

/** The stock's look: its kind, unknown ids (aliases of nothing) read as MDF like the 3D view. */
export function stockLook(project: Project): MaterialKind {
  // Partial projects (cut-list previews, tests) may come without a stock material.
  const id = project.stock.material as string | undefined;
  return (id ? materialKindOf(id) : null) ?? 'mdf';
}

interface Seeded {
  pose: Pose;
  role?: CabinetPartRole;
  group?: string;
}

/**
 * Seed poses of every part copy, keyed by `<partId>#<copy>`. Pure for a given project and the
 * cabinet role names (from tr.json, as T158).
 */
export function seedPoses(
  project: Project,
  roles: Readonly<Record<CabinetPartRole, string>>,
): Map<string, Seeded> {
  const out = new Map<string, Seeded>();
  const groups = cabinetGroups(project, roles);
  const row = rowLayout(groups);
  groups.forEach((g, gi) => {
    const dx = row.offsets[gi] ?? 0;
    const copies = new Map<string, number>();
    for (const b of g.assembly.boxes) {
      const part = g.parts.get(b.id);
      if (!part) continue;
      const copy = copies.get(b.id) ?? 0;
      copies.set(b.id, copy + 1);
      if (copy >= part.qty) continue;
      const thickness = partThickness(part, project);
      const mesh = cachedPartMesh(part, thickness);
      const m = assemblyFaceMatrix(b, g.assembly.width, hasFaceOnlyWork(part, thickness));
      m[12] = (m[12] ?? 0) + dx;
      const pose = roundPose(poseFromMatrix(m, boxCentre(localBoxOf(mesh))));
      out.set(assemblyInstanceId(b.id, copy), { pose, role: b.role, group: g.group });
    }
  });
  // Everything else lies flat in rows, in cut-list order, in front of the cabinets.
  const loose: { id: string; size: [number, number, number] }[] = [];
  let area = 0;
  for (const part of project.parts) {
    for (let copy = 0; copy < part.qty; copy++) {
      const id = assemblyInstanceId(part.id, copy);
      if (out.has(id)) continue;
      const size = boxSize(localBoxOf(cachedPartMesh(part, partThickness(part, project))));
      loose.push({ id, size });
      area += (size[0] + BENCH_GAP) * (size[1] + BENCH_GAP);
    }
  }
  const limit = Math.max(2400, row.width, Math.sqrt(area) * 1.4);
  let x = 0;
  let z = groups.length > 0 ? row.depth + BENCH_FRONT : 0;
  let rowDepth = 0;
  for (const { id, size } of loose) {
    const [w, h, t] = size;
    if (x > 0 && x + w > limit) {
      x = 0;
      z += rowDepth + BENCH_GAP;
      rowDepth = 0;
    }
    out.set(id, { pose: roundPose({ position: [x + w / 2, t / 2, z + h / 2], rotation: FLAT }) });
    x += w + BENCH_GAP;
    rowDepth = Math.max(rowDepth, h);
  }
  return out;
}

/** Every part copy of the project as a bench item (stored pose wins over the seed). */
export function benchItems(
  project: Project,
  roles: Readonly<Record<CabinetPartRole, string>>,
): BenchItem[] {
  const seeds = seedPoses(project, roles);
  const stored = new Map<string, AssemblyInstance>();
  for (const i of project.assembly?.instances ?? []) stored.set(i.id, i);
  const items: BenchItem[] = [];
  const stock = stockLook(project);
  const looks = new Map((project.assembly?.parts ?? []).map((p) => [p.partId, p.material]));
  for (const part of project.parts) {
    const own = looks.get(part.id);
    const thickness = partThickness(part, project);
    const mesh = cachedPartMesh(part, thickness);
    const box = localBoxOf(mesh);
    for (let copy = 0; copy < part.qty; copy++) {
      const id = assemblyInstanceId(part.id, copy);
      const seed = seeds.get(id);
      if (!seed) continue;
      const s = stored.get(id);
      items.push({
        id,
        partId: part.id,
        copy,
        part,
        thickness,
        mesh,
        box,
        seed: seed.pose,
        pose: s ? { position: [...s.position], rotation: [...s.rotation] } : seed.pose,
        hidden: s?.hidden ?? false,
        placed: s !== undefined,
        ...(seed.role ? { role: seed.role } : {}),
        ...(seed.group ? { group: seed.group } : {}),
        door: seed.role === 'door',
        look: own ?? stock,
        ownLook: own !== undefined,
      });
    }
  }
  return items;
}

/** The stored instance of an item at a new pose (rounded for storage). */
export function instanceOf(item: BenchItem, pose: Pose, hidden = item.hidden): AssemblyInstance {
  const p = roundPose(pose);
  return {
    id: item.id,
    partId: item.partId,
    copy: item.copy,
    position: p.position,
    rotation: p.rotation,
    hidden,
  };
}
