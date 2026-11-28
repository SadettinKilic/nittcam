/**
 * Montaj tezgâhı (T386, D-131): where each part copy stands in the project's 3D assembly.
 * Display only: nesting, toolpath and NC never read it. Old projects have no `assembly` (read as
 * empty: every copy at its seeded place, worked out by the app).
 *
 * Frame: millimetres, y up from the floor, x right, z toward the viewer (the cabinet frame of T158).
 * A part's local frame is the one of T153 (x along w, y along h, z = 0 sheet bottom, z = T the
 * machined top). `position` is the world position of the part's local bounding-box centre;
 * `rotation` is a unit quaternion [x, y, z, w] turning the local axes into the world:
 * world = position + R · (local − centre).
 */
import { z } from 'zod';
import { MATERIAL_KIND_IDS } from '../machine/material-kinds';

/** Largest coordinate a placed part may have, mm (a 100 m workbench). */
export const ASSEMBLY_COORD_MAX = 100_000;
/** At most this many placed copies per project (spec §3.8 budget is 300; room to spare). */
export const ASSEMBLY_INSTANCES_MAX = 5000;

const worldMm = z
  .number({ error: 'must be a number (mm)' })
  .min(-ASSEMBLY_COORD_MAX, { error: `must be within ±${ASSEMBLY_COORD_MAX} mm` })
  .max(ASSEMBLY_COORD_MAX, { error: `must be within ±${ASSEMBLY_COORD_MAX} mm` });

const quatPart = z
  .number({ error: 'must be a number' })
  .min(-1.000001, { error: 'quaternion parts lie in [-1, 1]' })
  .max(1.000001, { error: 'quaternion parts lie in [-1, 1]' });

export const assemblyInstanceSchema = z.strictObject({
  /** Unique within the assembly; the app uses `<partId>#<copy>`. */
  id: z.string({ error: 'must be a string' }).min(1, { error: 'must not be empty' }).max(200),
  partId: z.string({ error: 'must be a string' }).min(1, { error: 'must not be empty' }),
  /** Which copy of the part (0 … qty − 1). */
  copy: z
    .number({ error: 'must be a number' })
    .int({ error: 'must be an integer' })
    .min(0, { error: 'must be >= 0' }),
  position: z.tuple([worldMm, worldMm, worldMm]),
  rotation: z
    .tuple([quatPart, quatPart, quatPart, quatPart])
    .refine(([x, y, z, w]) => Math.abs(Math.hypot(x, y, z, w) - 1) <= 1e-3, {
      error: 'rotation must be a unit quaternion',
    }),
  hidden: z.boolean({ error: 'must be true or false' }),
});

/** Thinnest and thickest display thickness of a part in the assembly, mm (T390). */
export const ASSEMBLY_THICKNESS_MIN = 0.1;
export const ASSEMBLY_THICKNESS_MAX = 200;

/**
 * T390 (D-131): a part shown in another material than the project's stock (an aluminium bracket on
 * a wood panel), with its real thickness. Display only: nesting, toolpath and NC keep the stock.
 */
export const assemblyPartLookSchema = z.strictObject({
  partId: z.string({ error: 'must be a string' }).min(1, { error: 'must not be empty' }),
  material: z.enum(MATERIAL_KIND_IDS, { error: 'unknown material' }),
  thickness: z
    .number({ error: 'must be a number (mm)' })
    .min(ASSEMBLY_THICKNESS_MIN, { error: `must be at least ${ASSEMBLY_THICKNESS_MIN} mm` })
    .max(ASSEMBLY_THICKNESS_MAX, { error: `must be at most ${ASSEMBLY_THICKNESS_MAX} mm` }),
});

export const assemblySchema = z.strictObject({
  instances: z.array(assemblyInstanceSchema).max(ASSEMBLY_INSTANCES_MAX),
  /** T390: per-part material and thickness for the display (mixed materials); absent = stock. */
  parts: z
    .array(assemblyPartLookSchema)
    .max(ASSEMBLY_INSTANCES_MAX)
    .refine((list) => new Set(list.map((p) => p.partId)).size === list.length, {
      error: 'a part is given twice',
    })
    .optional(),
  /** T389: add the "Montaj föyü" page (exploded view + numbered part list) to the project PDF. */
  sheet: z.boolean({ error: 'must be true or false' }).optional(),
  /** Last edit (ISO 8601), passed in by the caller (core has no clock). */
  updatedAt: z.iso.datetime({ offset: true, error: 'updatedAt must be an ISO 8601 date-time' }),
});

export type AssemblyInstance = z.infer<typeof assemblyInstanceSchema>;
export type Assembly = z.infer<typeof assemblySchema>;
export type AssemblyPartLook = z.infer<typeof assemblyPartLookSchema>;

/** The id the app gives the instance of one part copy. */
export function assemblyInstanceId(partId: string, copy: number): string {
  return `${partId}#${copy}`;
}

/**
 * Keeps the assembly valid after a part edit (T386): instances of deleted parts and of copies above
 * the quantity are removed, duplicates (same id, or same part copy) keep the first. Works on a
 * plain project or an Immer draft; changes nothing when nothing is stale (no patches).
 */
export function pruneAssembly(project: {
  parts: readonly { id: string; qty: number }[];
  assembly?:
    | { instances: readonly AssemblyInstance[]; parts?: readonly AssemblyPartLook[] | undefined }
    | undefined;
}): void {
  const assembly = project.assembly;
  if (!assembly) return;
  // T390: looks of deleted parts go too (only when one is stale, so no patch otherwise).
  const partIds = assembly.parts ? new Set(project.parts.map((p) => p.id)) : null;
  if (assembly.parts && partIds && assembly.parts.some((p) => !partIds.has(p.partId))) {
    const kept = assembly.parts.filter((p) => partIds.has(p.partId));
    if (kept.length > 0) assembly.parts = kept;
    else delete assembly.parts;
  }
  if (assembly.instances.length === 0) return;
  const qty = new Map(project.parts.map((p) => [p.id, p.qty]));
  const ids = new Set<string>();
  const copies = new Set<string>();
  const keep = (i: AssemblyInstance) => {
    const q = qty.get(i.partId);
    if (q === undefined || i.copy >= q) return false;
    const copy = assemblyInstanceId(i.partId, i.copy);
    if (ids.has(i.id) || copies.has(copy)) return false;
    ids.add(i.id);
    copies.add(copy);
    return true;
  };
  // Only when something goes is the array replaced, so the common case leaves no patch.
  if (assembly.instances.every(keep)) return;
  ids.clear();
  copies.clear();
  assembly.instances = assembly.instances.filter(keep);
}
